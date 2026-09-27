#pragma once

#include <zdict.h>
#include <zstd.h>

#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

// Dictionary compression for small messages: train once on samples, prepare the dictionary once,
// then compress and decompress each message against it.
class ZstdDictionary {
public:
    // Trains on newline-separated samples; returns at most `capacity` bytes of dictionary.
    static std::u16string train(const std::string& samples, int capacity) {
        std::string joined;
        std::vector<size_t> sizes;
        for (size_t start = 0; start < samples.size();) {
            size_t end = samples.find('\n', start);
            if (end == std::string::npos) end = samples.size();
            joined.append(samples, start, end - start);
            sizes.push_back(end - start);
            start = end + 1;
        }
        std::string dictionary(static_cast<size_t>(capacity), '\0');
        const size_t size = ZDICT_trainFromBuffer(&dictionary[0], dictionary.size(), joined.data(), sizes.data(), static_cast<unsigned>(sizes.size()));
        if (ZDICT_isError(size)) throw std::runtime_error(ZDICT_getErrorName(size));
        dictionary.resize(size);
        return toUnits(dictionary);
    }

    // Digests the dictionary once for compression and once for decompression.
    ZstdDictionary(const std::u16string& dictionary, int level)
        : compressDictionary(nullptr, ZSTD_freeCDict), decompressDictionary(nullptr, ZSTD_freeDDict) {
        const std::string bytes = fromUnits(dictionary);
        compressDictionary.reset(ZSTD_createCDict(bytes.data(), bytes.size(), level));
        decompressDictionary.reset(ZSTD_createDDict(bytes.data(), bytes.size()));
        if (!compressDictionary || !decompressDictionary) throw std::runtime_error("not a usable dictionary");
    }

    std::u16string compress(const std::string& message) const {
        std::unique_ptr<ZSTD_CCtx, size_t (*)(ZSTD_CCtx*)> cctx(ZSTD_createCCtx(), ZSTD_freeCCtx);
        std::string out(ZSTD_compressBound(message.size()), '\0');
        out.resize(check(ZSTD_compress_usingCDict(cctx.get(), &out[0], out.size(), message.data(), message.size(), compressDictionary.get())));
        return toUnits(out);
    }

    std::string decompress(const std::u16string& frame) const {
        const std::string in = fromUnits(frame);
        const unsigned long long size = ZSTD_getFrameContentSize(in.data(), in.size());
        if (size == ZSTD_CONTENTSIZE_ERROR || size == ZSTD_CONTENTSIZE_UNKNOWN) throw std::runtime_error("not a zstd frame with its size");
        if (size > (1u << 20)) throw std::runtime_error("a message above 1 MiB is not a small message");
        std::unique_ptr<ZSTD_DCtx, size_t (*)(ZSTD_DCtx*)> dctx(ZSTD_createDCtx(), ZSTD_freeDCtx);
        std::string out(static_cast<size_t>(size), '\0');
        out.resize(check(ZSTD_decompress_usingDDict(dctx.get(), &out[0], out.size(), in.data(), in.size(), decompressDictionary.get())));
        return out;
    }

private:
    static size_t check(size_t code) {
        if (ZSTD_isError(code)) throw std::runtime_error(ZSTD_getErrorName(code));
        return code;
    }

    static std::u16string toUnits(const std::string& data) {
        std::u16string units(data.size(), u'\0');
        for (size_t i = 0; i < data.size(); ++i) units[i] = static_cast<unsigned char>(data[i]);
        return units;
    }

    static std::string fromUnits(const std::u16string& units) {
        std::string data(units.size(), '\0');
        for (size_t i = 0; i < units.size(); ++i) {
            if (units[i] > 0xFF) throw std::invalid_argument("not a byte string");
            data[i] = static_cast<char>(units[i]);
        }
        return data;
    }

    std::unique_ptr<ZSTD_CDict, size_t (*)(ZSTD_CDict*)> compressDictionary;
    std::unique_ptr<ZSTD_DDict, size_t (*)(ZSTD_DDict*)> decompressDictionary;
};
