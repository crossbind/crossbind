#pragma once

#include <webp/decode.h>

#include <algorithm>
#include <cstdint>
#include <cstring>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

#include "../support/files.h"

// The streaming app: libwebp's incremental decoder turns the part of a file that has arrived into
// the rows it can already show, the way an image fills in over a slow connection.
class WebpStream {
public:
    // Decodes the first `available` bytes of the file with WebPIUpdate and writes a width x height RGBA
    // frame to rgbaPath: the rows WebPIDecGetRGB reports as done, transparent below them. Returns
    // {"bytes","available","rows","width","height","complete"}. The size is known from the first 30 bytes
    // (WebPGetInfo); rows only start once the decoder has what it needs before the first row.
    static std::string decodePrefix(const std::string& webpPath, int available, const std::string& rgbaPath) {
        const std::vector<uint8_t> data = files::read(webpPath);
        const size_t size = std::min(data.size(), static_cast<size_t>(std::max(available, 0)));
        std::unique_ptr<WebPIDecoder, void (*)(WebPIDecoder*)> decoder(WebPINewRGB(MODE_RGBA, nullptr, 0, 0), WebPIDelete);
        if (!decoder) throw std::runtime_error("could not create a WebP decoder");
        const VP8StatusCode status = WebPIUpdate(decoder.get(), data.data(), size);
        if (status == VP8_STATUS_UNSUPPORTED_FEATURE) throw std::runtime_error("animated WebP files are not decoded incrementally");
        if (status != VP8_STATUS_OK && status != VP8_STATUS_SUSPENDED) throw std::runtime_error("not a decodable WebP image (status " + std::to_string(status) + ")");
        int rows = 0;
        int width = 0;
        int height = 0;
        int stride = 0;
        const uint8_t* rgba = WebPIDecGetRGB(decoder.get(), &rows, &width, &height, &stride);
        if (!rgba) {
            rows = 0;
            if (!WebPGetInfo(data.data(), size, &width, &height)) width = height = 0;
        }
        std::vector<uint8_t> frame(static_cast<size_t>(width) * height * 4, 0);
        for (int y = 0; y < rows; ++y) std::memcpy(&frame[static_cast<size_t>(y) * width * 4], rgba + static_cast<size_t>(y) * stride, static_cast<size_t>(width) * 4);
        files::write(rgbaPath, frame);
        return "{\"bytes\":" + std::to_string(data.size()) + ",\"available\":" + std::to_string(size) + ",\"rows\":" + std::to_string(rows) +
               ",\"width\":" + std::to_string(width) + ",\"height\":" + std::to_string(height) + ",\"complete\":" + (status == VP8_STATUS_OK ? "true" : "false") + "}";
    }
};
