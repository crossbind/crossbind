#pragma once

// ZSTD_getFrameHeader is in zstd's static API; safe with this statically linked, pinned library.
#define ZSTD_STATIC_LINKING_ONLY
#include <zstd.h>

#include <memory>
#include <stdexcept>
#include <string>

// A compression context with explicit parameters, and a reader for what they put in the frame header.
class ZstdFrame {
public:
    // A windowLog of 0 keeps the level's default window.
    static std::u16string compress(const std::string& text, int level, bool checksum, int windowLog) {
        std::unique_ptr<ZSTD_CCtx, size_t (*)(ZSTD_CCtx*)> cctx(ZSTD_createCCtx(), ZSTD_freeCCtx);
        check(ZSTD_CCtx_setParameter(cctx.get(), ZSTD_c_compressionLevel, level));
        check(ZSTD_CCtx_setParameter(cctx.get(), ZSTD_c_checksumFlag, checksum ? 1 : 0));
        if (windowLog) check(ZSTD_CCtx_setParameter(cctx.get(), ZSTD_c_windowLog, windowLog));
        std::string out(ZSTD_compressBound(text.size()), '\0');
        out.resize(check(ZSTD_compress2(cctx.get(), &out[0], out.size(), text.data(), text.size())));
        std::u16string bytes(out.size(), u'\0');
        for (size_t i = 0; i < out.size(); ++i) bytes[i] = static_cast<unsigned char>(out[i]);
        return bytes;
    }

    static std::string header(const std::u16string& frame) {
        std::string head;
        for (size_t i = 0; i < frame.size() && i < ZSTD_FRAMEHEADERSIZE_MAX; ++i) head += static_cast<char>(frame[i]);
        ZSTD_FrameHeader info;
        const size_t status = ZSTD_getFrameHeader(&info, head.data(), head.size());
        if (ZSTD_isError(status) || status > 0) throw std::runtime_error("not a zstd frame header");
        const std::string content = info.frameContentSize == ZSTD_CONTENTSIZE_UNKNOWN ? "not stored" : std::to_string(info.frameContentSize) + " B";
        return "content " + content + ", window " + std::to_string(info.windowSize) + " B, checksum " + (info.checksumFlag ? "yes" : "no");
    }

private:
    static size_t check(size_t code) {
        if (ZSTD_isError(code)) throw std::runtime_error(ZSTD_getErrorName(code));
        return code;
    }
};
