#pragma once

#include <tiffio.h>

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <stdexcept>
#include <string>
#include <vector>

// A multi-page TIFF, the way scanners and fax software store documents: every page is its own
// directory, closed with TIFFWriteDirectory and found again with TIFFSetDirectory. The pages are
// black and white, stored as 1-bit CCITT Group 4. Bytes cross the binding as std::u16string, one
// code unit (0-255) per byte.
//
// The file lives in memory through TIFFClientOpen. TIFFStreamOpen's std::ostream will not do here:
// adding a page reads the previous one back, and libtiff cannot read from an ostream.
class TiffPages {
public:
    TiffPages() : tif(openMemory(file, "w")) {}

    ~TiffPages() {
        if (tif) TIFFClose(tif);
    }

    // Appends a page from 8-bit grey pixels, one byte each: below 128 is black.
    void add(const std::u16string& grey, int width, int height, const std::string& name) {
        if (!tif) throw std::logic_error("the document is already finished");
        if (width <= 0 || height <= 0 || grey.size() != static_cast<size_t>(width) * height) throw std::invalid_argument("grey must hold width x height bytes");
        TIFFSetField(tif, TIFFTAG_SUBFILETYPE, FILETYPE_PAGE);
        TIFFSetField(tif, TIFFTAG_IMAGEWIDTH, width);
        TIFFSetField(tif, TIFFTAG_IMAGELENGTH, height);
        TIFFSetField(tif, TIFFTAG_BITSPERSAMPLE, 1);
        TIFFSetField(tif, TIFFTAG_SAMPLESPERPIXEL, 1);
        TIFFSetField(tif, TIFFTAG_PHOTOMETRIC, PHOTOMETRIC_MINISWHITE);
        TIFFSetField(tif, TIFFTAG_COMPRESSION, COMPRESSION_CCITTFAX4);
        TIFFSetField(tif, TIFFTAG_ROWSPERSTRIP, height);
        TIFFSetField(tif, TIFFTAG_PAGENUMBER, pages, 0);  // 0: the page count is not known yet
        TIFFSetField(tif, TIFFTAG_PAGENAME, name.c_str());
        std::vector<unsigned char> row((static_cast<size_t>(width) + 7) / 8);
        for (int y = 0; y < height; ++y) {
            std::fill(row.begin(), row.end(), 0);
            for (int x = 0; x < width; ++x) {
                if (grey[static_cast<size_t>(y) * width + x] < 128) row[x / 8] |= static_cast<unsigned char>(0x80 >> (x % 8));
            }
            if (TIFFWriteScanline(tif, row.data(), static_cast<uint32_t>(y), 0) < 0) throw std::runtime_error("libtiff could not write row " + std::to_string(y));
        }
        if (!TIFFWriteDirectory(tif)) throw std::runtime_error("libtiff could not finish page " + std::to_string(pages + 1));
        pages += 1;
    }

    // Closes the file and returns its bytes.
    std::u16string finish() {
        if (!tif) throw std::logic_error("the document is already finished");
        TIFFClose(tif);
        tif = nullptr;
        std::u16string units(file.bytes.size(), u'\0');
        for (size_t i = 0; i < file.bytes.size(); ++i) units[i] = static_cast<unsigned char>(file.bytes[i]);
        return units;
    }

    // One line per page: its number, name, size and codec.
    static std::string list(const std::u16string& tiff) {
        MemoryFile source(tiff);
        TIFF* in = openMemory(source, "r");
        std::string lines;
        do {
            uint32_t width = 0;
            uint32_t height = 0;
            uint16_t compression = 0;
            char* name = nullptr;
            TIFFGetField(in, TIFFTAG_IMAGEWIDTH, &width);
            TIFFGetField(in, TIFFTAG_IMAGELENGTH, &height);
            TIFFGetFieldDefaulted(in, TIFFTAG_COMPRESSION, &compression);
            const TIFFCodec* codec = TIFFFindCODEC(compression);
            lines += "page " + std::to_string(TIFFCurrentDirectory(in) + 1) + " \"" + (TIFFGetField(in, TIFFTAG_PAGENAME, &name) ? name : "") + "\": " +
                     std::to_string(width) + "x" + std::to_string(height) + ", " + (codec ? codec->name : "?") + "\n";
        } while (TIFFReadDirectory(in));
        TIFFClose(in);
        return lines;
    }

    // Page `index` (from 0) back as 8-bit grey, black 0 and white 255, read with TIFFReadScanline.
    static std::u16string grey(const std::u16string& tiff, int index) {
        MemoryFile source(tiff);
        TIFF* in = openMemory(source, "r");
        uint16_t bits = 0;
        if (index < 0 || !TIFFSetDirectory(in, static_cast<tdir_t>(index)) || !TIFFGetField(in, TIFFTAG_BITSPERSAMPLE, &bits) || bits != 1) {
            TIFFClose(in);
            throw std::out_of_range("there is no black-and-white page " + std::to_string(index));
        }
        uint32_t width = 0;
        uint32_t height = 0;
        TIFFGetField(in, TIFFTAG_IMAGEWIDTH, &width);
        TIFFGetField(in, TIFFTAG_IMAGELENGTH, &height);
        std::vector<unsigned char> row(static_cast<size_t>(TIFFScanlineSize(in)));
        std::u16string pixels(static_cast<size_t>(width) * height, u'\0');
        for (uint32_t y = 0; y < height; ++y) {
            if (TIFFReadScanline(in, row.data(), y, 0) < 0) {
                TIFFClose(in);
                throw std::runtime_error("libtiff could not read row " + std::to_string(y));
            }
            for (uint32_t x = 0; x < width; ++x) pixels[static_cast<size_t>(y) * width + x] = (row[x / 8] & (0x80 >> (x % 8))) ? 0 : 255;
        }
        TIFFClose(in);
        return pixels;
    }

private:
    // A growable file in memory, and the read, write and seek procs libtiff calls on it.
    struct MemoryFile {
        std::string bytes;
        uint64_t position = 0;

        MemoryFile() = default;
        explicit MemoryFile(const std::u16string& units) : bytes(units.size(), '\0') {
            for (size_t i = 0; i < units.size(); ++i) {
                if (units[i] > 0xFF) throw std::invalid_argument("not a byte string: a code unit is above 255");
                bytes[i] = static_cast<char>(units[i]);
            }
        }

        static tmsize_t read(thandle_t handle, void* buffer, tmsize_t size) {
            MemoryFile* self = static_cast<MemoryFile*>(handle);
            const uint64_t left = self->position < self->bytes.size() ? self->bytes.size() - self->position : 0;
            const size_t count = static_cast<size_t>(std::min<uint64_t>(left, static_cast<uint64_t>(size)));
            std::memcpy(buffer, self->bytes.data() + self->position, count);
            self->position += count;
            return static_cast<tmsize_t>(count);
        }
        static tmsize_t write(thandle_t handle, void* buffer, tmsize_t size) {
            MemoryFile* self = static_cast<MemoryFile*>(handle);
            if (self->bytes.size() < self->position + size) self->bytes.resize(static_cast<size_t>(self->position + size));
            std::memcpy(&self->bytes[static_cast<size_t>(self->position)], buffer, static_cast<size_t>(size));
            self->position += size;
            return size;
        }
        static toff_t seek(thandle_t handle, toff_t offset, int whence) {
            MemoryFile* self = static_cast<MemoryFile*>(handle);
            const uint64_t base = whence == SEEK_CUR ? self->position : whence == SEEK_END ? self->bytes.size() : 0;
            self->position = base + offset;
            return self->position;
        }
        static toff_t size(thandle_t handle) { return static_cast<MemoryFile*>(handle)->bytes.size(); }
        static int close(thandle_t) { return 0; }
        static int map(thandle_t, void**, toff_t*) { return 0; }
        static void unmap(thandle_t, void*, toff_t) {}
    };

    static TIFF* openMemory(MemoryFile& memory, const char* mode) {
        TIFF* opened = TIFFClientOpen("memory", mode, &memory, MemoryFile::read, MemoryFile::write, MemoryFile::seek, MemoryFile::close, MemoryFile::size,
                                      MemoryFile::map, MemoryFile::unmap);
        if (!opened) throw std::runtime_error(*mode == 'w' ? "libtiff could not open a file in memory" : "not a TIFF libtiff can read");
        return opened;
    }

    MemoryFile file;
    TIFF* tif = nullptr;
    int pages = 0;
};
