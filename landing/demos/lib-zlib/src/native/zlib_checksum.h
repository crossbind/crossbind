#pragma once

#include <zlib.h>

#include <string>

// CRC-32 (what gzip, ZIP and PNG store) and Adler-32 (what the zlib format stores). A running value
// continues across pieces, and two values combine into the checksum of the joined data, so pieces can
// be checksummed separately, in any order.
class Checksum {
public:
    static unsigned int crc32(const std::string& data) { return crc32Update(0, data); }
    static unsigned int adler32(const std::string& data) { return adler32Update(1, data); }

    static unsigned int crc32Update(unsigned int crc, const std::string& data) {
        return static_cast<unsigned int>(::crc32(crc, reinterpret_cast<const Bytef*>(data.data()), static_cast<uInt>(data.size())));
    }

    static unsigned int adler32Update(unsigned int adler, const std::string& data) {
        return static_cast<unsigned int>(::adler32(adler, reinterpret_cast<const Bytef*>(data.data()), static_cast<uInt>(data.size())));
    }

    // The checksum of first + second, from the two checksums and the length of second in bytes.
    static unsigned int crc32Combine(unsigned int first, unsigned int second, double secondLength) {
        return static_cast<unsigned int>(::crc32_combine(first, second, static_cast<z_off_t>(secondLength)));
    }

    static unsigned int adler32Combine(unsigned int first, unsigned int second, double secondLength) {
        return static_cast<unsigned int>(::adler32_combine(first, second, static_cast<z_off_t>(secondLength)));
    }
};
