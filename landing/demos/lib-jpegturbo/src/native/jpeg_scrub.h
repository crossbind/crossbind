#pragma once

#include <cstdio>
#include <jpeglib.h>

#include <string>
#include <utility>
#include <vector>

#include "../support/exif.h"
#include "../support/jpeg_io.h"
#include "../support/scene.h"

// Finds what a photo says about where, when and with what it was taken, and writes a copy without
// it. The image itself is not re-encoded: its quantised DCT coefficients are copied as they are, so
// every pixel decodes the same. Paths are in the module's filesystem; the page mounts a dropped file
// there first.
class JpegScrub {
public:
    // A 1200x800 photo the way a phone writes one: baseline with the standard Huffman tables, EXIF
    // with camera, time, GPS and an embedded preview, an XMP packet and a comment. The photo is a
    // crop of a wider scene, and the preview still shows the uncropped scene. Returns its size.
    static int writeSample(const std::string& path) {
        const std::string wide = scene::photo(2000, 800);
        std::string cropped;
        cropped.reserve(static_cast<size_t>(1200) * 800 * 3);
        for (int y = 0; y < 800; ++y) cropped.append(wide, (static_cast<size_t>(y) * 2000 + 800) * 3, static_cast<size_t>(1200) * 3);
        exif::Camera camera{"crossbind", "Sample Phone 1", "crossbind sample 1.0", "2026:09:24 10:30:00", "Sample 26mm f/1.8", "CB-2026-000123", "Sample Owner",
                            41025631, 28974156, 620, encode(scene::photo(200, 80), 200, 80, 70, false)};
        const std::string exifBlock = exif::build(camera);
        const std::string xmp = std::string("http://ns.adobe.com/xap/1.0/", 29) +
                                "<x:xmpmeta xmlns:x=\"adobe:ns:meta/\"><rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">"
                                "<rdf:Description xmlns:xmp=\"http://ns.adobe.com/xap/1.0/\" xmp:CreatorTool=\"crossbind sample 1.0\" xmp:Rating=\"5\"/>"
                                "</rdf:RDF></x:xmpmeta>";
        const std::string file = encode(cropped, 1200, 800, 85, false, {{JPEG_APP0 + 1, exifBlock}, {JPEG_APP0 + 1, xmp}, {JPEG_COM, "crossbind sample photo"}});
        jpegio::writeFile(path, file);
        return static_cast<int>(file.size());
    }

    // {"bytes","width","height","components","subsampling","progressive","arithmetic","quality":{...},
    //  "segments":[{"marker","label","bytes"}],"trailing","exif":{...}|null,"preview":{"width","height"}|null,"warnings","warning"}.
    // `trailing` counts bytes after the end of the image, where MPF files keep further pictures.
    static std::string inspect(const std::string& path) {
        const std::string file = jpegio::readFile(path);
        jpegio::Decompressor decoder;
        jpeg_mem_src(&decoder.cinfo, reinterpret_cast<const unsigned char*>(file.data()), file.size());
        jpegio::saveAllMarkers(&decoder.cinfo);
        jpeg_read_header(&decoder.cinfo, TRUE);
        std::string segments;
        std::string exifJson = "null";
        std::string preview = "null";
        for (jpeg_saved_marker_ptr marker = decoder.cinfo.marker_list; marker != nullptr; marker = marker->next) {
            segments += std::string(segments.empty() ? "" : ",") + "{\"marker\":\"" + jpegio::markerName(marker->marker) + "\",\"label\":\"" +
                        jpegio::markerLabel(marker) + "\",\"bytes\":" + std::to_string(marker->data_length) + "}";
            if (exifJson != "null" || marker->marker != JPEG_APP0 + 1 || !jpegio::startsWith(marker, "Exif\0", 6)) continue;
            std::pair<size_t, size_t> thumbnail;
            exifJson = exif::summary(marker->data + 6, marker->data_length - 6, nullptr, &thumbnail);
            if (thumbnail.second) preview = previewSize(std::string(reinterpret_cast<const char*>(marker->data + 6 + thumbnail.first), thumbnail.second));
        }
        const jpeg_decompress_struct& info = decoder.cinfo;
        const std::string head = "{\"bytes\":" + std::to_string(file.size()) + ",\"width\":" + std::to_string(info.image_width) +
                                 ",\"height\":" + std::to_string(info.image_height) + ",\"components\":" + std::to_string(info.num_components) +
                                 ",\"subsampling\":\"" + jpegio::subsampling(info) + "\",\"progressive\":" + (info.progressive_mode ? "true" : "false") +
                                 ",\"arithmetic\":" + (info.arith_code ? "true" : "false") + ",\"quality\":" + jpegio::estimatedQuality(info);
        jpeg_read_coefficients(&decoder.cinfo);  // reads up to the end of the image, so whatever follows it can be counted
        jpeg_finish_decompress(&decoder.cinfo);
        return head + ",\"segments\":[" + segments + "],\"trailing\":" + std::to_string(decoder.cinfo.src->bytes_in_buffer) + ",\"exif\":" + exifJson +
               ",\"preview\":" + preview + "," + decoder.warnings() + "}";
    }

    // The preview inside the EXIF block, written to `output` as the JPEG it is; returns its size, 0 when there is none.
    static int extractPreview(const std::string& path, const std::string& output) {
        const std::string file = jpegio::readFile(path);
        jpegio::Decompressor decoder;
        jpeg_mem_src(&decoder.cinfo, reinterpret_cast<const unsigned char*>(file.data()), file.size());
        jpeg_save_markers(&decoder.cinfo, JPEG_APP0 + 1, 0xFFFF);
        jpeg_read_header(&decoder.cinfo, TRUE);
        for (jpeg_saved_marker_ptr marker = decoder.cinfo.marker_list; marker != nullptr; marker = marker->next) {
            if (!jpegio::startsWith(marker, "Exif\0", 6)) continue;
            std::pair<size_t, size_t> thumbnail;
            exif::summary(marker->data + 6, marker->data_length - 6, nullptr, &thumbnail);
            if (!thumbnail.second) return 0;
            jpegio::writeFile(output, std::string(reinterpret_cast<const char*>(marker->data + 6 + thumbnail.first), thumbnail.second));
            return static_cast<int>(thumbnail.second);
        }
        return 0;
    }

    // Writes `output` with the image and only what is kept: the colour profile when keepProfile, and,
    // when keepOrientation and the photo is stored rotated, a new EXIF block holding the orientation
    // alone. {"before","after","kept":[...],"removed":[...],"trailing","warnings","warning"}.
    static std::string clean(const std::string& input, const std::string& output, bool keepProfile, bool keepOrientation, bool optimize, bool progressive) {
        const std::string file = jpegio::readFile(input);
        jpegio::Decompressor source;
        jpeg_mem_src(&source.cinfo, reinterpret_cast<const unsigned char*>(file.data()), file.size());
        jpegio::saveAllMarkers(&source.cinfo);
        jpeg_read_header(&source.cinfo, TRUE);
        const int orientation = exif::orientation(source.cinfo);
        jvirt_barray_ptr* coefficients = jpeg_read_coefficients(&source.cinfo);

        jpegio::Compressor target;
        jpegio::File out = jpegio::open(output, "wb");
        jpeg_stdio_dest(&target.cinfo, out.get());
        jpeg_copy_critical_parameters(&source.cinfo, &target.cinfo);
        target.cinfo.write_JFIF_header = source.cinfo.saw_JFIF_marker;
        target.cinfo.optimize_coding = optimize ? TRUE : FALSE;
        if (progressive) jpeg_simple_progression(&target.cinfo);
        jpeg_write_coefficients(&target.cinfo, coefficients);

        std::string kept, removed;
        const auto note = [](std::string& list, const std::string& marker, const std::string& label, size_t bytes) {
            list += std::string(list.empty() ? "" : ",") + "{\"marker\":\"" + marker + "\",\"label\":\"" + label + "\",\"bytes\":" + std::to_string(bytes) + "}";
        };
        if (keepOrientation && orientation > 1) {
            const std::string block = exif::orientationOnly(orientation);
            jpeg_write_marker(&target.cinfo, JPEG_APP0 + 1, reinterpret_cast<const JOCTET*>(block.data()), static_cast<unsigned int>(block.size()));
            note(kept, "APP1", "Exif, orientation " + std::to_string(orientation) + " only", block.size());
        }
        for (jpeg_saved_marker_ptr marker = source.cinfo.marker_list; marker != nullptr; marker = marker->next) {
            const std::string name = jpegio::markerName(marker->marker);
            const std::string label = jpegio::markerLabel(marker);
            const bool jfif = marker->marker == JPEG_APP0 && label == "JFIF";
            const bool adobe = marker->marker == JPEG_APP0 + 14 && label == "Adobe";
            const bool profile = marker->marker == JPEG_APP0 + 2 && label == "ICC profile";
            if (jfif && target.cinfo.write_JFIF_header) {
                note(kept, name, label, marker->data_length);  // rewritten by the library from the same values
            } else if (adobe || (profile && keepProfile)) {
                if (!(adobe && target.cinfo.write_Adobe_marker)) jpeg_write_marker(&target.cinfo, marker->marker, marker->data, marker->data_length);
                note(kept, name, label, marker->data_length);
            } else {
                note(removed, name, label, marker->data_length);
            }
        }
        jpeg_finish_compress(&target.cinfo);
        jpeg_finish_decompress(&source.cinfo);
        const size_t trailing = source.cinfo.src->bytes_in_buffer;
        const long after = std::ftell(out.get());
        out.reset();
        return "{\"before\":" + std::to_string(file.size()) + ",\"after\":" + std::to_string(after) + ",\"kept\":[" + kept + "],\"removed\":[" + removed +
               "],\"trailing\":" + std::to_string(trailing) + "," + source.warnings() + "}";
    }

    // Decodes both files in step and counts the samples that differ: {"samples","differing","warnings","warning"}.
    static std::string compare(const std::string& first, const std::string& second) {
        const std::string a = jpegio::readFile(first);
        const std::string b = jpegio::readFile(second);
        jpegio::Decompressor left, right;
        jpeg_mem_src(&left.cinfo, reinterpret_cast<const unsigned char*>(a.data()), a.size());
        jpeg_mem_src(&right.cinfo, reinterpret_cast<const unsigned char*>(b.data()), b.size());
        jpeg_read_header(&left.cinfo, TRUE);
        jpeg_read_header(&right.cinfo, TRUE);
        jpeg_start_decompress(&left.cinfo);
        jpeg_start_decompress(&right.cinfo);
        if (left.cinfo.output_width != right.cinfo.output_width || left.cinfo.output_height != right.cinfo.output_height ||
            left.cinfo.output_components != right.cinfo.output_components) {
            throw std::runtime_error("the two images differ in size or colour components");
        }
        const size_t stride = static_cast<size_t>(left.cinfo.output_width) * left.cinfo.output_components;
        std::vector<JSAMPLE> rowA(stride), rowB(stride);
        unsigned long long differing = 0;
        while (left.cinfo.output_scanline < left.cinfo.output_height) {
            JSAMPROW pointerA = rowA.data();
            JSAMPROW pointerB = rowB.data();
            jpeg_read_scanlines(&left.cinfo, &pointerA, 1);
            jpeg_read_scanlines(&right.cinfo, &pointerB, 1);
            for (size_t i = 0; i < stride; ++i) differing += rowA[i] != rowB[i];
        }
        const unsigned long long samples = static_cast<unsigned long long>(stride) * left.cinfo.output_height;
        jpeg_finish_decompress(&left.cinfo);
        jpeg_finish_decompress(&right.cinfo);
        return "{\"samples\":" + std::to_string(samples) + ",\"differing\":" + std::to_string(differing) + "," + left.warnings() + "}";
    }

private:
    // Baseline, standard Huffman tables and no JFIF segment unless asked: what a phone camera writes.
    static std::string encode(const std::string& rgb, int width, int height, int quality, bool jfif, const std::vector<std::pair<int, std::string>>& markers = {}) {
        jpegio::Compressor encoder;
        unsigned char* buffer = nullptr;
        unsigned long size = 0;
        jpeg_mem_dest(&encoder.cinfo, &buffer, &size);
        encoder.cinfo.image_width = static_cast<JDIMENSION>(width);
        encoder.cinfo.image_height = static_cast<JDIMENSION>(height);
        encoder.cinfo.input_components = 3;
        encoder.cinfo.in_color_space = JCS_RGB;
        jpeg_set_defaults(&encoder.cinfo);
        jpeg_set_quality(&encoder.cinfo, quality, TRUE);
        encoder.cinfo.write_JFIF_header = jfif ? TRUE : FALSE;
        jpeg_start_compress(&encoder.cinfo, TRUE);
        for (const auto& marker : markers) {
            jpeg_write_marker(&encoder.cinfo, marker.first, reinterpret_cast<const JOCTET*>(marker.second.data()), static_cast<unsigned int>(marker.second.size()));
        }
        while (encoder.cinfo.next_scanline < encoder.cinfo.image_height) {
            JSAMPROW row = reinterpret_cast<JSAMPROW>(const_cast<char*>(&rgb[static_cast<size_t>(encoder.cinfo.next_scanline) * width * 3]));
            jpeg_write_scanlines(&encoder.cinfo, &row, 1);
        }
        // jpeg_mem_dest reallocates as the file grows and hands the final buffer over only here.
        jpeg_finish_compress(&encoder.cinfo);
        std::string file(reinterpret_cast<const char*>(buffer), size);
        std::free(buffer);
        return file;
    }

    static std::string previewSize(const std::string& preview) {
        try {
            jpegio::Decompressor decoder;
            jpeg_mem_src(&decoder.cinfo, reinterpret_cast<const unsigned char*>(preview.data()), preview.size());
            jpeg_read_header(&decoder.cinfo, TRUE);
            return "{\"width\":" + std::to_string(decoder.cinfo.image_width) + ",\"height\":" + std::to_string(decoder.cinfo.image_height) + "}";
        } catch (const std::exception&) {
            return "null";  // the EXIF summary still reports the preview's size in bytes
        }
    }
};
