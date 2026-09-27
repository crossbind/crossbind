#pragma once

#include <chrono>
#include <cstdio>
#include <jpeglib.h>
#include <malloc.h>

#include <stdexcept>
#include <string>
#include <utility>

#include "../support/exif.h"
#include "../support/jpeg_io.h"
#include "../support/scene.h"

// Measures what DCT scaling saves: the same file decoded at 1/1, 1/2, 1/4 and 1/8, timed in the
// module, with what libjpeg-turbo allocates for each decode read from the allocator.
class ThumbnailBench {
public:
    // The generated scene at 4032x3024, the size a 12 MP phone camera writes, at quality 85.
    // Returns the file size.
    static int writeSample(const std::string& path) {
        const int width = 4032, height = 3024;
        const std::string rgb = scene::photo(width, height);
        jpegio::Compressor encoder;
        jpegio::File out = jpegio::open(path, "wb");
        jpeg_stdio_dest(&encoder.cinfo, out.get());
        encoder.cinfo.image_width = width;
        encoder.cinfo.image_height = height;
        encoder.cinfo.input_components = 3;
        encoder.cinfo.in_color_space = JCS_RGB;
        jpeg_set_defaults(&encoder.cinfo);
        jpeg_set_quality(&encoder.cinfo, 85, TRUE);
        jpeg_start_compress(&encoder.cinfo, TRUE);
        while (encoder.cinfo.next_scanline < encoder.cinfo.image_height) {
            JSAMPROW row = reinterpret_cast<JSAMPROW>(const_cast<char*>(&rgb[static_cast<size_t>(encoder.cinfo.next_scanline) * width * 3]));
            jpeg_write_scanlines(&encoder.cinfo, &row, 1);
        }
        jpeg_finish_compress(&encoder.cinfo);
        return static_cast<int>(std::ftell(out.get()));
    }

    // Decodes at 1/denominator (1, 2, 4 or 8) `runs` times into an RGBA buffer of the output size.
    // {"width","height","ms","workBytes","pixelBytes","progressive","warnings","warning"}: ms is the fastest run, workBytes
    // what libjpeg-turbo itself allocated. The last run's pixels, upright, go to rgbaPath unless empty.
    static std::string decode(const std::string& path, int denominator, int runs, const std::string& rgbaPath) {
        if (denominator != 1 && denominator != 2 && denominator != 4 && denominator != 8) throw std::invalid_argument("denominator must be 1, 2, 4 or 8");
        if (runs < 1 || runs > 20) throw std::invalid_argument("runs must be between 1 and 20");
        const std::string file = jpegio::readFile(path);
        double best = -1;
        size_t work = 0;
        int width = 0, height = 0, orientation = 1;
        bool progressive = false;
        std::string warnings;
        std::string rgba;
        for (int run = 0; run < runs; ++run) {
            rgba.clear();
            rgba.shrink_to_fit();
            const size_t before = mallinfo().uordblks;
            const auto started = std::chrono::steady_clock::now();
            jpegio::Decompressor decoder;
            jpeg_mem_src(&decoder.cinfo, reinterpret_cast<const unsigned char*>(file.data()), file.size());
            jpeg_save_markers(&decoder.cinfo, JPEG_APP0 + 1, 0xFFFF);
            jpeg_read_header(&decoder.cinfo, TRUE);
            if (decoder.cinfo.jpeg_color_space == JCS_CMYK || decoder.cinfo.jpeg_color_space == JCS_YCCK) throw std::runtime_error("CMYK JPEGs are print files; this benchmark decodes RGB photos");
            orientation = exif::orientation(decoder.cinfo);  // saved markers are freed by jpeg_finish_decompress
            progressive = decoder.cinfo.progressive_mode;
            decoder.cinfo.scale_num = 1;
            decoder.cinfo.scale_denom = static_cast<unsigned int>(denominator);
            decoder.cinfo.out_color_space = JCS_EXT_RGBA;
            jpeg_start_decompress(&decoder.cinfo);
            work = mallinfo().uordblks - before;
            const size_t stride = static_cast<size_t>(decoder.cinfo.output_width) * 4;
            rgba.assign(stride * decoder.cinfo.output_height, '\0');
            while (decoder.cinfo.output_scanline < decoder.cinfo.output_height) {
                JSAMPROW row = reinterpret_cast<JSAMPROW>(&rgba[decoder.cinfo.output_scanline * stride]);
                jpeg_read_scanlines(&decoder.cinfo, &row, 1);
            }
            jpeg_finish_decompress(&decoder.cinfo);
            const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();
            best = best < 0 || ms < best ? ms : best;
            width = static_cast<int>(decoder.cinfo.output_width);
            height = static_cast<int>(decoder.cinfo.output_height);
            warnings = decoder.warnings();
        }
        const size_t pixelBytes = rgba.size();
        if (!rgbaPath.empty()) {
            jpegio::writeFile(rgbaPath, exif::upright(rgba, width, height, 4, orientation));
        } else if (orientation >= 5) {
            std::swap(width, height);  // the size as the photo is shown
        }
        return "{\"width\":" + std::to_string(width) + ",\"height\":" + std::to_string(height) + ",\"ms\":" + jpegio::fixed(best, 1) +
               ",\"workBytes\":" + std::to_string(work) + ",\"pixelBytes\":" + std::to_string(pixelBytes) + ",\"progressive\":" + (progressive ? "true" : "false") + "," + warnings + "}";
    }
};
