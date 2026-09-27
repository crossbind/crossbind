#pragma once

#include <tiffio.h>

#include <cstdio>
#include <cstdlib>
#include <stdexcept>
#include <string>

// A TIFF by path, which is how files reach C++: mounted from an <input type="file"> in a browser,
// or from the app's storage on a phone. TIFFOpen reads only what each call needs, so the size of
// the file does not matter.
class TiffFile {
public:
    static int pages(const std::string& path) {
        TIFF* tif = open(path);
        const int count = static_cast<int>(TIFFNumberOfDirectories(tif));
        TIFFClose(tif);
        return count;
    }

    // Page `index` (from 0) as TIFFPrintDirectory prints it, the report the tiffinfo tool shows.
    static std::string directory(const std::string& path, int index) {
        TIFF* tif = open(path);
        if (index < 0 || !TIFFSetDirectory(tif, static_cast<tdir_t>(index))) {
            TIFFClose(tif);
            throw std::out_of_range("there is no page " + std::to_string(index));
        }
        char* text = nullptr;
        size_t size = 0;
        FILE* report = open_memstream(&text, &size);
        if (!report) {
            TIFFClose(tif);
            throw std::runtime_error("could not open a memory stream");
        }
        TIFFPrintDirectory(tif, report, TIFFPRINT_NONE);
        std::fclose(report);
        TIFFClose(tif);
        const std::string printed(text, size);
        std::free(text);
        return printed;
    }

private:
    static TIFF* open(const std::string& path) {
        TIFF* tif = TIFFOpen(path.c_str(), "r");
        if (!tif) throw std::runtime_error("not a TIFF libtiff can read: " + path);
        return tif;
    }
};
