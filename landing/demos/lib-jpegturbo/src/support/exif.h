#pragma once

#include <cstdint>
#include <cstdio>
#include <string>
#include <utility>
#include <vector>

#include "jpeg_io.h"

// EXIF is a small TIFF file inside APP1, after "Exif\0\0". This reads the tags a privacy check cares
// about (camera, time, GPS, owner, serial, the embedded preview) with every offset bounds-checked, and
// writes the two EXIF blocks the apps need: orientation alone, and the sample photo's full set.
namespace exif {

class Tiff {
public:
    Tiff(const unsigned char* data, size_t size) : data(data), size(size), little(size >= 2 && data[0] == 'I') {}

    bool valid() const { return size >= 8 && ((data[0] == 'I' && data[1] == 'I') || (data[0] == 'M' && data[1] == 'M')) && u16(2) == 42; }
    unsigned u16(size_t at) const { return at + 2 > size ? 0 : little ? data[at] | data[at + 1] << 8 : data[at] << 8 | data[at + 1]; }
    uint32_t u32(size_t at) const { return at + 4 > size ? 0 : little ? u16(at) | static_cast<uint32_t>(u16(at + 2)) << 16 : static_cast<uint32_t>(u16(at)) << 16 | u16(at + 2); }

    struct Entry {
        unsigned tag = 0, type = 0;
        uint32_t count = 0;
        size_t at = 0;  // where the value bytes start, or 0 when they fall outside the block
    };

    // The entries of the IFD at `offset`; `next` receives the following IFD's offset.
    std::vector<Entry> ifd(size_t offset, uint32_t* next) const {
        std::vector<Entry> entries;
        if (next) *next = 0;
        if (offset == 0 || offset + 2 > size) return entries;
        const unsigned count = u16(offset);
        if (offset + 2 + static_cast<size_t>(count) * 12 + 4 > size) return entries;
        for (unsigned index = 0; index < count; ++index) {
            const size_t at = offset + 2 + static_cast<size_t>(index) * 12;
            Entry entry;
            entry.tag = u16(at);
            entry.type = u16(at + 2);
            entry.count = u32(at + 4);
            const size_t unit = entry.type == 3 ? 2 : entry.type == 4 || entry.type == 9 ? 4 : entry.type == 5 || entry.type == 10 ? 8 : 1;
            const size_t bytes = unit * entry.count;
            const size_t value = bytes <= 4 ? at + 8 : u32(at + 8);
            entry.at = entry.count < (1u << 24) && value + bytes <= size ? value : 0;
            entries.push_back(entry);
        }
        if (next) *next = u32(offset + 2 + static_cast<size_t>(count) * 12);
        return entries;
    }

    std::string ascii(const Entry& entry) const {
        if (!entry.at) return "";
        std::string text(reinterpret_cast<const char*>(data + entry.at), entry.count);
        const size_t end = text.find('\0');
        if (end != std::string::npos) text.resize(end);
        while (!text.empty() && text.back() == ' ') text.pop_back();
        return text;
    }

    unsigned number(const Entry& entry) const {
        if (!entry.at) return 0;
        return entry.type == 3 ? u16(entry.at) : entry.type == 4 ? u32(entry.at) : data[entry.at];
    }

    double rational(const Entry& entry, unsigned index) const {
        if (!entry.at || index >= entry.count || entry.type != 5) return 0;
        const uint32_t denominator = u32(entry.at + index * 8 + 4);
        return denominator ? static_cast<double>(u32(entry.at + index * 8)) / denominator : 0;
    }

private:
    const unsigned char* data;
    size_t size;
    bool little;
};

// What an EXIF block reveals, as JSON; `tiffData` points after "Exif\0\0".
inline std::string summary(const unsigned char* tiffData, size_t tiffSize, int* orientationOut, std::pair<size_t, size_t>* thumbnailOut) {
    const Tiff tiff(tiffData, tiffSize);
    if (orientationOut) *orientationOut = 0;
    if (thumbnailOut) *thumbnailOut = {0, 0};
    if (!tiff.valid()) return "{\"valid\":false}";
    std::string make, model, software, dateTime, taken, lens, serial, owner;
    unsigned orientation = 0;
    size_t tags = 0;
    uint32_t exifOffset = 0, gpsOffset = 0, next = 0;
    for (const Tiff::Entry& entry : tiff.ifd(tiff.u32(4), &next)) {
        tags += 1;
        if (entry.tag == 0x010F) make = tiff.ascii(entry);
        if (entry.tag == 0x0110) model = tiff.ascii(entry);
        if (entry.tag == 0x0112) orientation = tiff.number(entry);
        if (entry.tag == 0x0131) software = tiff.ascii(entry);
        if (entry.tag == 0x0132) dateTime = tiff.ascii(entry);
        if (entry.tag == 0x8769) exifOffset = tiff.number(entry);
        if (entry.tag == 0x8825) gpsOffset = tiff.number(entry);
    }
    for (const Tiff::Entry& entry : tiff.ifd(exifOffset, nullptr)) {
        tags += 1;
        if (entry.tag == 0x9003) taken = tiff.ascii(entry);
        if (entry.tag == 0xA430) owner = tiff.ascii(entry);
        if (entry.tag == 0xA431) serial = tiff.ascii(entry);
        if (entry.tag == 0xA434) lens = tiff.ascii(entry);
    }
    std::string gps = "null";
    const std::vector<Tiff::Entry> gpsEntries = tiff.ifd(gpsOffset, nullptr);
    tags += gpsEntries.size();
    const Tiff::Entry* latitude = nullptr;
    const Tiff::Entry* longitude = nullptr;
    const Tiff::Entry* altitude = nullptr;
    char latitudeRef = 'N', longitudeRef = 'E';
    bool below = false;
    for (const Tiff::Entry& entry : gpsEntries) {
        if (entry.tag == 1 && entry.at) latitudeRef = static_cast<char>(tiffData[entry.at]);
        if (entry.tag == 2 && entry.count >= 3) latitude = &entry;
        if (entry.tag == 3 && entry.at) longitudeRef = static_cast<char>(tiffData[entry.at]);
        if (entry.tag == 4 && entry.count >= 3) longitude = &entry;
        if (entry.tag == 5) below = tiff.number(entry) == 1;
        if (entry.tag == 6) altitude = &entry;
    }
    if (latitude && longitude) {
        const auto degrees = [&](const Tiff::Entry& entry) { return tiff.rational(entry, 0) + tiff.rational(entry, 1) / 60 + tiff.rational(entry, 2) / 3600; };
        const double lat = degrees(*latitude) * (latitudeRef == 'S' ? -1 : 1);
        const double lon = degrees(*longitude) * (longitudeRef == 'W' ? -1 : 1);
        gps = "{\"lat\":" + jpegio::fixed(lat, 6) + ",\"lon\":" + jpegio::fixed(lon, 6) +
              ",\"alt\":" + (altitude ? jpegio::fixed(tiff.rational(*altitude, 0) * (below ? -1 : 1), 1) : std::string("null")) + "}";
    }
    size_t thumbnailAt = 0, thumbnailBytes = 0;
    for (const Tiff::Entry& entry : tiff.ifd(next, nullptr)) {
        tags += 1;
        if (entry.tag == 0x0201) thumbnailAt = tiff.number(entry);
        if (entry.tag == 0x0202) thumbnailBytes = tiff.number(entry);
    }
    if (thumbnailAt == 0 || thumbnailAt + thumbnailBytes > tiffSize) thumbnailBytes = 0;
    if (orientationOut) *orientationOut = static_cast<int>(orientation);
    if (thumbnailOut && thumbnailBytes) *thumbnailOut = {thumbnailAt, thumbnailBytes};
    const auto quoted = [](const std::string& value) { return value.empty() ? std::string("null") : jpegio::jsonString(value); };
    return "{\"valid\":true,\"make\":" + quoted(make) + ",\"model\":" + quoted(model) + ",\"software\":" + quoted(software) + ",\"dateTime\":" + quoted(dateTime) +
           ",\"taken\":" + quoted(taken) + ",\"orientation\":" + std::to_string(orientation) + ",\"lens\":" + quoted(lens) + ",\"serial\":" + quoted(serial) +
           ",\"owner\":" + quoted(owner) + ",\"gps\":" + gps + ",\"thumbnailBytes\":" + std::to_string(thumbnailBytes) + ",\"tags\":" + std::to_string(tags) + "}";
}

// The EXIF orientation of a JPEG whose markers were saved (1 when there is none).
inline int orientation(const jpeg_decompress_struct& info) {
    for (jpeg_saved_marker_ptr marker = info.marker_list; marker != nullptr; marker = marker->next) {
        if (marker->marker != JPEG_APP0 + 1 || !jpegio::startsWith(marker, "Exif\0", 6)) continue;
        int value = 0;
        summary(marker->data + 6, marker->data_length - 6, &value, nullptr);
        return value >= 1 && value <= 8 ? value : 1;
    }
    return 1;
}

// A big-endian TIFF writer: IFDs are laid out one after another, each followed by its long values.
struct Field {
    unsigned tag, type;
    uint32_t count;
    std::string value;  // big-endian bytes
};

inline std::string be16(unsigned value) { return std::string{static_cast<char>(value >> 8 & 255), static_cast<char>(value & 255)}; }
inline std::string be32(uint32_t value) { return be16(value >> 16) + be16(value & 0xFFFF); }
inline Field text(unsigned tag, const std::string& value) { return {tag, 2, static_cast<uint32_t>(value.size() + 1), value + std::string(1, '\0')}; }
inline Field shortValue(unsigned tag, unsigned value) { return {tag, 3, 1, be16(value)}; }
inline Field longValue(unsigned tag, uint32_t value) { return {tag, 4, 1, be32(value)}; }
inline Field rationals(unsigned tag, const std::vector<std::pair<uint32_t, uint32_t>>& values) {
    std::string bytes;
    for (const auto& value : values) bytes += be32(value.first) + be32(value.second);
    return {tag, 5, static_cast<uint32_t>(values.size()), bytes};
}

inline size_t ifdSize(const std::vector<Field>& fields) {
    size_t size = 2 + fields.size() * 12 + 4;
    for (const Field& field : fields) size += field.value.size() > 4 ? (field.value.size() + 1) / 2 * 2 : 0;
    return size;
}

inline std::string writeIfd(const std::vector<Field>& fields, size_t start, uint32_t next) {
    std::string head = be16(static_cast<unsigned>(fields.size()));
    std::string tail;
    const size_t dataAt = start + 2 + fields.size() * 12 + 4;
    for (const Field& field : fields) {
        head += be16(field.tag) + be16(field.type) + be32(field.count);
        if (field.value.size() <= 4) {
            head += field.value + std::string(4 - field.value.size(), '\0');
        } else {
            head += be32(static_cast<uint32_t>(dataAt + tail.size()));
            tail += field.value;
            if (tail.size() % 2) tail += '\0';
        }
    }
    return head + be32(next) + tail;
}

// APP1 payload carrying nothing but the orientation.
inline std::string orientationOnly(int orientation) {
    const std::vector<Field> ifd0 = {shortValue(0x0112, static_cast<unsigned>(orientation))};
    return std::string("Exif\0\0MM", 8) + be16(42) + be32(8) + writeIfd(ifd0, 8, 0);
}

// Degrees as the three EXIF rationals: degrees, minutes, seconds in 1/100.
inline std::vector<std::pair<uint32_t, uint32_t>> dms(uint32_t microdegrees) {
    const uint32_t degrees = microdegrees / 1000000;
    const uint64_t minutesE6 = static_cast<uint64_t>(microdegrees % 1000000) * 60;
    const uint32_t minutes = static_cast<uint32_t>(minutesE6 / 1000000);
    const uint32_t hundredthSeconds = static_cast<uint32_t>((minutesE6 % 1000000) * 60 / 10000);
    return {{degrees, 1}, {minutes, 1}, {hundredthSeconds, 100}};
}

struct Camera {
    std::string make, model, software, dateTime, lens, serial, owner;
    uint32_t latitudeE6, longitudeE6;  // north and east
    uint32_t altitudeDecimetres;
    std::string thumbnail;             // a JPEG
};

// A full EXIF block as a phone writes one: IFD0, the Exif IFD, the GPS IFD and IFD1 with a preview.
inline std::string build(const Camera& camera) {
    std::vector<Field> ifd0 = {text(0x010F, camera.make), text(0x0110, camera.model), shortValue(0x0112, 1), text(0x0131, camera.software),
                               text(0x0132, camera.dateTime), longValue(0x8769, 0), longValue(0x8825, 0)};
    const std::vector<Field> exifIfd = {text(0x9003, camera.dateTime), text(0xA430, camera.owner), text(0xA431, camera.serial), text(0xA434, camera.lens)};
    const std::vector<Field> gpsIfd = {{0x0000, 1, 4, std::string("\2\3\0\0", 4)}, text(0x0001, "N"), rationals(0x0002, dms(camera.latitudeE6)),
                                       text(0x0003, "E"), rationals(0x0004, dms(camera.longitudeE6)), {0x0005, 1, 1, std::string(1, '\0')},
                                       rationals(0x0006, {{camera.altitudeDecimetres, 10}})};
    std::vector<Field> ifd1 = {shortValue(0x0103, 6), longValue(0x0201, 0), longValue(0x0202, static_cast<uint32_t>(camera.thumbnail.size()))};
    const size_t at0 = 8;
    const size_t atExif = at0 + ifdSize(ifd0);
    const size_t atGps = atExif + ifdSize(exifIfd);
    const size_t at1 = atGps + ifdSize(gpsIfd);
    const size_t atThumbnail = at1 + ifdSize(ifd1);
    ifd0[5] = longValue(0x8769, static_cast<uint32_t>(atExif));
    ifd0[6] = longValue(0x8825, static_cast<uint32_t>(atGps));
    ifd1[1] = longValue(0x0201, static_cast<uint32_t>(atThumbnail));
    return std::string("Exif\0\0MM", 8) + be16(42) + be32(8) + writeIfd(ifd0, at0, static_cast<uint32_t>(at1)) + writeIfd(exifIfd, atExif, 0) +
           writeIfd(gpsIfd, atGps, 0) + writeIfd(ifd1, at1, 0) + camera.thumbnail;
}

// Turns pixels upright as the EXIF orientation (1-8) asks; width and height swap for 5-8.
inline std::string upright(const std::string& pixels, int& width, int& height, int channels, int orientation) {
    if (orientation <= 1 || orientation > 8) return pixels;
    const int w = width, h = height;
    const bool swap = orientation >= 5;
    const int outWidth = swap ? h : w;
    const int outHeight = swap ? w : h;
    std::string out(pixels.size(), '\0');
    for (int y = 0; y < outHeight; ++y) {
        for (int x = 0; x < outWidth; ++x) {
            int sx = x, sy = y;
            switch (orientation) {
                case 2: sx = w - 1 - x; break;
                case 3: sx = w - 1 - x; sy = h - 1 - y; break;
                case 4: sy = h - 1 - y; break;
                case 5: sx = y; sy = x; break;
                case 6: sx = y; sy = h - 1 - x; break;
                case 7: sx = w - 1 - y; sy = h - 1 - x; break;
                case 8: sx = w - 1 - y; sy = x; break;
            }
            out.replace((static_cast<size_t>(y) * outWidth + x) * channels, channels, pixels, (static_cast<size_t>(sy) * w + sx) * channels, channels);
        }
    }
    width = outWidth;
    height = outHeight;
    return out;
}

}  // namespace exif
