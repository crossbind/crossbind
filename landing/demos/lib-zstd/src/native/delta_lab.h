#pragma once

// Skippable frames are in zstd's static API; that is safe with this statically linked, pinned library.
#ifndef ZSTD_STATIC_LINKING_ONLY
#define ZSTD_STATIC_LINKING_ONLY
#endif
#include <zstd.h>

#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

#include "../support/bytes.h"
#include "../support/corpus.h"

// Ships a new version of a dataset as its difference from the previous one: zstd compresses v2 with
// v1 as a raw prefix. Behind a 40-byte header naming v1 by its SHA-256, that is the `dcz` format of
// RFC 9842 (Compression Dictionary Transport), which Chrome decodes natively for HTTP.
class DeltaLab {
public:
    // v1 is 2,000 records; v2 gives every 50th record's follower count a leading 1 and appends 20 records.
    DeltaLab() {
        const std::vector<std::string> records = corpus::users(2020);
        std::vector<std::string> next(records.begin(), records.begin() + 2000);
        previousText = corpus::lines(next);
        for (size_t index = 0; index < next.size(); index += 50) next[index] = bumpFollowers(next[index]);
        next.insert(next.end(), records.begin() + 2000, records.end());
        nextText = corpus::lines(next);
    }

    int v1Bytes() const { return static_cast<int>(previousText.size()); }
    int v2Bytes() const { return static_cast<int>(nextText.size()); }

    // v2 compressed on its own.
    int aloneBytes(int level) const { return static_cast<int>(frame(level, 0, false, false).size()); }

    // v2 compressed with v1 as its prefix. A windowLog of 0 keeps the level's default window.
    int deltaBytes(int level, int windowLog, bool longMode) const { return static_cast<int>(frame(level, windowLog, longMode, true).size()); }

    // v1 itself, so the page can hash it: dcz names its dictionary by SHA-256.
    std::u16string v1() const { return bytes::toUnits(previousText); }

    // v2 itself, so the page can measure what the browser's own gzip makes of it.
    std::u16string v2() const { return bytes::toUnits(nextText); }

    // RFC 9842 dcz: a skippable frame (magic 0x184D2A5E) carrying the SHA-256 of v1, then the delta frame.
    std::u16string dcz(const std::u16string& sha256OfV1, int level, bool longMode) const {
        const std::string digest = bytes::fromUnits(sha256OfV1);
        if (digest.size() != 32) throw std::invalid_argument("dcz names its dictionary by a 32-byte SHA-256");
        std::string header(ZSTD_SKIPPABLEHEADERSIZE + digest.size(), '\0');
        header.resize(check(ZSTD_writeSkippableFrame(&header[0], header.size(), digest.data(), digest.size(), 0xE)));
        return bytes::toUnits(header + frame(level, 22, longMode, true));
    }

    // Reads a dcz stream back: skips the header, decodes the frame against v1 and compares it with v2.
    bool verify(const std::u16string& stream) const {
        const std::string data = bytes::fromUnits(stream);
        if (data.size() < ZSTD_SKIPPABLEHEADERSIZE || !ZSTD_isSkippableFrame(data.data(), data.size())) return false;
        const size_t headerSize = check(ZSTD_findFrameCompressedSize(data.data(), data.size()));
        std::unique_ptr<ZSTD_DCtx, size_t (*)(ZSTD_DCtx*)> dctx(ZSTD_createDCtx(), ZSTD_freeDCtx);
        if (!dctx) throw std::runtime_error("zstd could not allocate a decompression context");
        check(ZSTD_DCtx_refPrefix(dctx.get(), previousText.data(), previousText.size()));
        std::string decoded(nextText.size(), '\0');
        const size_t got = ZSTD_decompressDCtx(dctx.get(), &decoded[0], decoded.size(), data.data() + headerSize, data.size() - headerSize);
        return !ZSTD_isError(got) && got == nextText.size() && decoded == nextText;
    }

private:
    static size_t check(size_t code) {
        if (ZSTD_isError(code)) throw std::runtime_error(ZSTD_getErrorName(code));
        return code;
    }

    static std::string bumpFollowers(const std::string& record) {
        static const std::string key = "\"followers\":";
        const size_t at = record.find(key);
        if (at == std::string::npos) return record;
        std::string bumped = record;
        bumped.insert(at + key.size(), "1");
        return bumped;
    }

    std::string frame(int level, int windowLog, bool longMode, bool withPrefix) const {
        std::unique_ptr<ZSTD_CCtx, size_t (*)(ZSTD_CCtx*)> cctx(ZSTD_createCCtx(), ZSTD_freeCCtx);
        if (!cctx) throw std::runtime_error("zstd could not allocate a compression context");
        check(ZSTD_CCtx_setParameter(cctx.get(), ZSTD_c_compressionLevel, level));
        if (windowLog) check(ZSTD_CCtx_setParameter(cctx.get(), ZSTD_c_windowLog, windowLog));
        if (longMode) check(ZSTD_CCtx_setParameter(cctx.get(), ZSTD_c_enableLongDistanceMatching, ZSTD_ps_enable));
        if (withPrefix) check(ZSTD_CCtx_refPrefix(cctx.get(), previousText.data(), previousText.size()));
        std::string out(ZSTD_compressBound(nextText.size()), '\0');
        out.resize(check(ZSTD_compress2(cctx.get(), &out[0], out.size(), nextText.data(), nextText.size())));
        return out;
    }

    std::string previousText;
    std::string nextText;
};
