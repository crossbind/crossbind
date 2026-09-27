#pragma once

#include <zdict.h>
#include <zstd.h>

#include <algorithm>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

#include "../support/bytes.h"
#include "../support/corpus.h"

// Teaches zstd what API records look like, then measures what that buys on records the trainer never
// saw: the first half of the generated records trains the dictionary, the second half is compressed
// one record at a time. The records stay in wasm memory; only sizes and the dictionary cross.
class DictionaryLab {
public:
    explicit DictionaryLab(int records) {
        if (records < 100 || records > 5000) throw std::invalid_argument("records must be between 100 and 5000");
        const std::vector<std::string> all = corpus::users(records * 2);
        training.assign(all.begin(), all.begin() + records);
        evaluation.assign(all.begin() + records, all.end());
    }

    int samples() const { return static_cast<int>(training.size()); }

    // Trains a dictionary of at most `capacity` bytes and returns the size it came out at.
    int train(int capacity) {
        if (capacity < 256 || capacity > (128 << 10)) throw std::invalid_argument("dictionary capacity must be between 256 B and 128 KB");
        std::string joined;
        std::vector<size_t> sizes;
        for (const std::string& record : training) {
            joined += record;
            sizes.push_back(record.size());
        }
        std::string trained(static_cast<size_t>(capacity), '\0');
        const size_t size = ZDICT_trainFromBuffer(&trained[0], trained.size(), joined.data(), sizes.data(), static_cast<unsigned>(sizes.size()));
        if (ZDICT_isError(size)) throw std::runtime_error(ZDICT_getErrorName(size));
        trained.resize(size);
        dictionary = trained;
        return static_cast<int>(size);
    }

    unsigned int dictionaryId() const { return ZDICT_getDictID(dictionary.data(), dictionary.size()); }

    // The printable end of the dictionary, where the trainer keeps the substrings it found most useful.
    std::string preview(int maxBytes) const {
        requireDictionary();
        const size_t take = std::min(dictionary.size(), static_cast<size_t>(std::max(maxBytes, 0)));
        std::string tail = dictionary.substr(dictionary.size() - take);
        for (char& character : tail) {
            const unsigned char value = static_cast<unsigned char>(character);
            if (value < 32 || value > 126) character = '.';
        }
        return tail;
    }

    // Compresses every held-out record on its own, without and with the dictionary, and decodes each
    // dictionary frame back. JSON: {"records","raw","plain","withDictionary","roundtrip","sample":[[raw,plain,with],...]}
    std::string evaluate(int level, bool trimHeaders) const {
        requireDictionary();
        std::unique_ptr<ZSTD_CCtx, size_t (*)(ZSTD_CCtx*)> cctx(ZSTD_createCCtx(), ZSTD_freeCCtx);
        std::unique_ptr<ZSTD_DCtx, size_t (*)(ZSTD_DCtx*)> dctx(ZSTD_createDCtx(), ZSTD_freeDCtx);
        std::unique_ptr<ZSTD_CDict, size_t (*)(ZSTD_CDict*)> cdict(ZSTD_createCDict(dictionary.data(), dictionary.size(), level), ZSTD_freeCDict);
        std::unique_ptr<ZSTD_DDict, size_t (*)(ZSTD_DDict*)> ddict(ZSTD_createDDict(dictionary.data(), dictionary.size()), ZSTD_freeDDict);
        if (!cctx || !dctx || !cdict || !ddict) throw std::runtime_error("zstd could not allocate its contexts");
        check(ZSTD_DCtx_refDDict(dctx.get(), ddict.get()));

        size_t raw = 0;
        size_t plain = 0;
        size_t withDictionary = 0;
        bool roundtrip = true;
        std::string sample = "[";
        std::string frame;
        std::string decoded;
        for (size_t index = 0; index < evaluation.size(); index += 1) {
            const std::string& record = evaluation[index];
            const size_t plainSize = compress(cctx.get(), nullptr, level, false, record, frame);
            const size_t dictionarySize = compress(cctx.get(), cdict.get(), level, trimHeaders, record, frame);
            decoded.assign(record.size(), '\0');
            const size_t got = ZSTD_decompressDCtx(dctx.get(), &decoded[0], decoded.size(), frame.data(), frame.size());
            roundtrip = roundtrip && !ZSTD_isError(got) && got == record.size() && decoded == record;
            raw += record.size();
            plain += plainSize;
            withDictionary += dictionarySize;
            if (index < 48) {
                sample += (index ? ",[" : "[") + std::to_string(record.size()) + "," + std::to_string(plainSize) + "," + std::to_string(dictionarySize) + "]";
            }
        }
        return "{\"records\":" + std::to_string(evaluation.size()) + ",\"raw\":" + std::to_string(raw) + ",\"plain\":" + std::to_string(plain) +
               ",\"withDictionary\":" + std::to_string(withDictionary) + ",\"roundtrip\":" + (roundtrip ? "true" : "false") + ",\"sample\":" + sample + "]}";
    }

    // The trained dictionary, as `zstd -D <file>` and every zstd binding read it.
    std::u16string dictionaryBytes() const {
        requireDictionary();
        return bytes::toUnits(dictionary);
    }

private:
    void requireDictionary() const {
        if (dictionary.empty()) throw std::logic_error("train a dictionary first");
    }

    static size_t check(size_t code) {
        if (ZSTD_isError(code)) throw std::runtime_error(ZSTD_getErrorName(code));
        return code;
    }

    // One frame per record. The dictionary frames can drop the content size and dictionary ID, which
    // matter more than anything else when a record is a few hundred bytes.
    static size_t compress(ZSTD_CCtx* cctx, const ZSTD_CDict* cdict, int level, bool trimHeaders, const std::string& input, std::string& frame) {
        check(ZSTD_CCtx_reset(cctx, ZSTD_reset_session_and_parameters));
        check(ZSTD_CCtx_setParameter(cctx, ZSTD_c_compressionLevel, level));
        if (trimHeaders) {
            check(ZSTD_CCtx_setParameter(cctx, ZSTD_c_contentSizeFlag, 0));
            check(ZSTD_CCtx_setParameter(cctx, ZSTD_c_dictIDFlag, 0));
        }
        if (cdict) check(ZSTD_CCtx_refCDict(cctx, cdict));
        frame.resize(ZSTD_compressBound(input.size()));
        const size_t size = check(ZSTD_compress2(cctx, &frame[0], frame.size(), input.data(), input.size()));
        frame.resize(size);
        return size;
    }

    std::vector<std::string> training;
    std::vector<std::string> evaluation;
    std::string dictionary;
};
