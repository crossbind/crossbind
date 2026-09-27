#pragma once

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <jpeglib.h>

#include <stdexcept>
#include <string>

#include "../support/exif.h"
#include "../support/jpeg_io.h"
#include "../support/scene.h"

// Encodes one picture with every setting libjpeg-turbo offers and measures what each costs in bytes
// and in fidelity (PSNR over R, G and B against the picture before encoding). The picture is the
// generated sample or a JPEG from the module's filesystem.
class JpegLab {
public:
    // The generated scene; {"width","height","focus":{"x","y","w","h"}}, focus being where to zoom.
    std::string useSample(int sampleWidth, int sampleHeight) {
        rgb = scene::photo(sampleWidth, sampleHeight);
        width = sampleWidth;
        height = sampleHeight;
        const scene::Rect text = scene::banner(width, height);
        focus = fit({text.x + text.w / 12, text.y + text.h / 2 - 32, 96, 64});
        return describe("{\"source\":\"sample\"");
    }

    // A JPEG decoded straight to the largest size M/8 whose long side fits maxSide, then turned
    // upright by its EXIF orientation; {"width","height","originalWidth","originalHeight","scale","orientation","focus","warnings","warning"}.
    std::string load(const std::string& path, int maxSide) {
        if (maxSide < 64) throw std::invalid_argument("maxSide must be at least 64");
        const std::string file = jpegio::readFile(path);
        jpegio::Decompressor decoder;
        jpeg_mem_src(&decoder.cinfo, reinterpret_cast<const unsigned char*>(file.data()), file.size());
        jpeg_save_markers(&decoder.cinfo, JPEG_APP0 + 1, 0xFFFF);
        jpeg_read_header(&decoder.cinfo, TRUE);
        if (decoder.cinfo.jpeg_color_space == JCS_CMYK || decoder.cinfo.jpeg_color_space == JCS_YCCK) throw std::runtime_error("CMYK JPEGs are print files; this lab works on RGB photos");
        const unsigned int longSide = std::max(decoder.cinfo.image_width, decoder.cinfo.image_height);
        unsigned int eighths = 8;
        while (eighths > 1 && (longSide * eighths + 7) / 8 > static_cast<unsigned int>(maxSide)) eighths -= 1;
        decoder.cinfo.scale_num = eighths;
        decoder.cinfo.scale_denom = 8;
        decoder.cinfo.out_color_space = JCS_RGB;
        const int orientation = exif::orientation(decoder.cinfo);
        jpeg_start_decompress(&decoder.cinfo);
        int decodedWidth = static_cast<int>(decoder.cinfo.output_width);
        int decodedHeight = static_cast<int>(decoder.cinfo.output_height);
        std::string pixels(static_cast<size_t>(decodedWidth) * decodedHeight * 3, '\0');
        while (decoder.cinfo.output_scanline < decoder.cinfo.output_height) {
            JSAMPROW row = reinterpret_cast<JSAMPROW>(&pixels[static_cast<size_t>(decoder.cinfo.output_scanline) * decodedWidth * 3]);
            jpeg_read_scanlines(&decoder.cinfo, &row, 1);
        }
        jpeg_finish_decompress(&decoder.cinfo);
        rgb = exif::upright(pixels, decodedWidth, decodedHeight, 3, orientation);
        width = decodedWidth;
        height = decodedHeight;
        focus = fit({width / 2 - 48, height / 2 - 32, 96, 64});
        return describe("{\"source\":\"file\",\"originalWidth\":" + std::to_string(decoder.cinfo.image_width) + ",\"originalHeight\":" +
                        std::to_string(decoder.cinfo.image_height) + ",\"scale\":\"" + std::to_string(eighths) + "/8\",\"orientation\":" + std::to_string(orientation) +
                        "," + decoder.warnings());
    }

    // The picture as RGBA, for the page's canvas and for the browser's own encoder.
    void writeSource(const std::string& path) const {
        requirePicture();
        std::string rgba(static_cast<size_t>(width) * height * 4, '\xff');
        for (size_t pixel = 0; pixel < static_cast<size_t>(width) * height; ++pixel) rgba.replace(pixel * 4, 3, rgb, pixel * 3, 3);
        jpegio::writeFile(path, rgba);
    }

    // Encodes the picture; the file goes to jpegPath and its decoded RGBA to viewPath.
    // subsampling: 444, 422 or 420. {"bytes","psnr" (null when lossless),"encodeMs"}.
    std::string encode(int quality, int subsampling, bool progressive, bool optimize, bool arithmetic, const std::string& jpegPath, const std::string& viewPath) const {
        requirePicture();
        if (quality < 1 || quality > 100) throw std::invalid_argument("quality must be between 1 and 100");
        if (subsampling != 444 && subsampling != 422 && subsampling != 420) throw std::invalid_argument("subsampling must be 444, 422 or 420");
        const auto started = std::chrono::steady_clock::now();
        {
            jpegio::Compressor encoder;
            jpegio::File out = jpegio::open(jpegPath, "wb");
            jpeg_stdio_dest(&encoder.cinfo, out.get());
            encoder.cinfo.image_width = static_cast<JDIMENSION>(width);
            encoder.cinfo.image_height = static_cast<JDIMENSION>(height);
            encoder.cinfo.input_components = 3;
            encoder.cinfo.in_color_space = JCS_RGB;
            jpeg_set_defaults(&encoder.cinfo);
            jpeg_set_quality(&encoder.cinfo, quality, TRUE);
            encoder.cinfo.comp_info[0].h_samp_factor = subsampling == 444 ? 1 : 2;
            encoder.cinfo.comp_info[0].v_samp_factor = subsampling == 420 ? 2 : 1;
            encoder.cinfo.optimize_coding = optimize ? TRUE : FALSE;
            encoder.cinfo.arith_code = arithmetic ? TRUE : FALSE;
            if (progressive) jpeg_simple_progression(&encoder.cinfo);
            jpeg_start_compress(&encoder.cinfo, TRUE);
            while (encoder.cinfo.next_scanline < encoder.cinfo.image_height) {
                JSAMPROW row = reinterpret_cast<JSAMPROW>(const_cast<char*>(&rgb[static_cast<size_t>(encoder.cinfo.next_scanline) * width * 3]));
                jpeg_write_scanlines(&encoder.cinfo, &row, 1);
            }
            jpeg_finish_compress(&encoder.cinfo);
        }
        const double encodeMs = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();
        const std::string file = jpegio::readFile(jpegPath);
        return "{\"bytes\":" + std::to_string(file.size()) + ",\"psnr\":" + psnr(file, viewPath) + ",\"encodeMs\":" + jpegio::fixed(encodeMs, 1) + "}";
    }

    // Any JPEG of the same picture, such as what canvas.toBlob made of it:
    // {"bytes","psnr","subsampling","progressive","arithmetic","quality":{"quality","exact"}}.
    std::string measure(const std::string& jpegPath) const {
        requirePicture();
        const std::string file = jpegio::readFile(jpegPath);
        jpegio::Decompressor decoder;
        jpeg_mem_src(&decoder.cinfo, reinterpret_cast<const unsigned char*>(file.data()), file.size());
        jpeg_read_header(&decoder.cinfo, TRUE);
        const jpeg_decompress_struct& info = decoder.cinfo;
        return "{\"bytes\":" + std::to_string(file.size()) + ",\"psnr\":" + psnr(file, "") + ",\"subsampling\":\"" + jpegio::subsampling(info) +
               "\",\"progressive\":" + (info.progressive_mode ? "true" : "false") + ",\"arithmetic\":" + (info.arith_code ? "true" : "false") +
               ",\"quality\":" + jpegio::estimatedQuality(info) + "}";
    }

private:
    void requirePicture() const {
        if (rgb.empty()) throw std::logic_error("load a picture first: useSample or load");
    }

    scene::Rect fit(scene::Rect rect) const {
        rect.w = std::min(rect.w, width);
        rect.h = std::min(rect.h, height);
        rect.x = std::max(0, std::min(rect.x, width - rect.w));
        rect.y = std::max(0, std::min(rect.y, height - rect.h));
        return rect;
    }

    std::string describe(const std::string& head) const {
        return head + ",\"width\":" + std::to_string(width) + ",\"height\":" + std::to_string(height) + ",\"focus\":{\"x\":" + std::to_string(focus.x) +
               ",\"y\":" + std::to_string(focus.y) + ",\"w\":" + std::to_string(focus.w) + ",\"h\":" + std::to_string(focus.h) + "}}";
    }

    // Decodes `file`, compares it with the picture and writes the decoded RGBA to viewPath unless empty.
    std::string psnr(const std::string& file, const std::string& viewPath) const {
        jpegio::Decompressor decoder;
        jpeg_mem_src(&decoder.cinfo, reinterpret_cast<const unsigned char*>(file.data()), file.size());
        jpeg_read_header(&decoder.cinfo, TRUE);
        decoder.cinfo.out_color_space = JCS_RGB;
        jpeg_start_decompress(&decoder.cinfo);
        if (static_cast<int>(decoder.cinfo.output_width) != width || static_cast<int>(decoder.cinfo.output_height) != height) {
            throw std::runtime_error("the JPEG is " + std::to_string(decoder.cinfo.output_width) + "x" + std::to_string(decoder.cinfo.output_height) + ", the picture " +
                                     std::to_string(width) + "x" + std::to_string(height));
        }
        std::string row(static_cast<size_t>(width) * 3, '\0');
        std::string rgba = viewPath.empty() ? std::string() : std::string(static_cast<size_t>(width) * height * 4, '\xff');
        unsigned long long squared = 0;
        while (decoder.cinfo.output_scanline < decoder.cinfo.output_height) {
            const size_t y = decoder.cinfo.output_scanline;
            JSAMPROW pointer = reinterpret_cast<JSAMPROW>(&row[0]);
            jpeg_read_scanlines(&decoder.cinfo, &pointer, 1);
            const unsigned char* original = reinterpret_cast<const unsigned char*>(&rgb[y * width * 3]);
            for (size_t i = 0; i < row.size(); ++i) {
                const int difference = static_cast<unsigned char>(row[i]) - original[i];
                squared += static_cast<unsigned long long>(difference * difference);
            }
            if (!rgba.empty()) {
                for (size_t x = 0; x < static_cast<size_t>(width); ++x) rgba.replace((y * width + x) * 4, 3, row, x * 3, 3);
            }
        }
        jpeg_finish_decompress(&decoder.cinfo);
        if (!rgba.empty()) jpegio::writeFile(viewPath, rgba);
        if (squared == 0) return "null";
        const double mse = static_cast<double>(squared) / (static_cast<double>(width) * height * 3);
        return jpegio::fixed(10 * std::log10(255.0 * 255.0 / mse), 2);
    }

    std::string rgb;
    int width = 0;
    int height = 0;
    scene::Rect focus{0, 0, 0, 0};
};
