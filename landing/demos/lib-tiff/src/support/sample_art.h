#pragma once

#include <algorithm>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

// The pictures the apps start from, drawn with integer arithmetic only, so the same pixels come
// out on every machine and the host reference can rebuild them: a text page, a landscape photo,
// fluorescent cells as a 12-bit microscope records them, and an elevation model.
namespace tiffapps {
namespace art {

class Lcg {
public:
    explicit Lcg(uint32_t seed) : state(seed) {}
    uint32_t next() {
        state = state * 1664525u + 1013904223u;
        return state;
    }
    // 0 .. n-1 from the high bits, which are the random ones in an LCG.
    uint32_t below(uint32_t n) { return static_cast<uint32_t>((static_cast<uint64_t>(next() >> 8) * n) >> 24); }

private:
    uint32_t state;
};

// A 5x7 font: one byte per row, bit 4 is the left column.
inline const uint8_t* glyph(char character) {
    static const char* const characters = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,-:;/#()'&%+";
    static const uint8_t rows[][7] = {
        {0, 0, 0, 0, 0, 0, 0},
        {0x0E, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11}, {0x1E, 0x11, 0x11, 0x1E, 0x11, 0x11, 0x1E}, {0x0E, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0E},
        {0x1C, 0x12, 0x11, 0x11, 0x11, 0x12, 0x1C}, {0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x1F}, {0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x10},
        {0x0E, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0F}, {0x11, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11}, {0x0E, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0E},
        {0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0C}, {0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11}, {0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1F},
        {0x11, 0x1B, 0x15, 0x15, 0x11, 0x11, 0x11}, {0x11, 0x11, 0x19, 0x15, 0x13, 0x11, 0x11}, {0x0E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E},
        {0x1E, 0x11, 0x11, 0x1E, 0x10, 0x10, 0x10}, {0x0E, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0D}, {0x1E, 0x11, 0x11, 0x1E, 0x14, 0x12, 0x11},
        {0x0F, 0x10, 0x10, 0x0E, 0x01, 0x01, 0x1E}, {0x1F, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04}, {0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E},
        {0x11, 0x11, 0x11, 0x11, 0x11, 0x0A, 0x04}, {0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0A}, {0x11, 0x11, 0x0A, 0x04, 0x0A, 0x11, 0x11},
        {0x11, 0x11, 0x11, 0x0A, 0x04, 0x04, 0x04}, {0x1F, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1F},
        {0x0E, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0E}, {0x04, 0x0C, 0x04, 0x04, 0x04, 0x04, 0x0E}, {0x0E, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1F},
        {0x1F, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0E}, {0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02}, {0x1F, 0x10, 0x1E, 0x01, 0x01, 0x11, 0x0E},
        {0x06, 0x08, 0x10, 0x1E, 0x11, 0x11, 0x0E}, {0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08}, {0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E},
        {0x0E, 0x11, 0x11, 0x0F, 0x01, 0x02, 0x0C},
        {0, 0, 0, 0, 0, 0x0C, 0x0C}, {0, 0, 0, 0, 0x0C, 0x04, 0x08}, {0, 0, 0, 0x1F, 0, 0, 0}, {0, 0x0C, 0x0C, 0, 0x0C, 0x0C, 0},
        {0, 0x0C, 0x0C, 0, 0x0C, 0x04, 0x08}, {0, 0x01, 0x02, 0x04, 0x08, 0x10, 0}, {0x0A, 0x0A, 0x1F, 0x0A, 0x1F, 0x0A, 0x0A},
        {0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02}, {0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08}, {0x0C, 0x04, 0x08, 0, 0, 0, 0},
        {0x0C, 0x12, 0x14, 0x08, 0x15, 0x12, 0x0D}, {0x18, 0x19, 0x02, 0x04, 0x08, 0x13, 0x03}, {0, 0x04, 0x04, 0x1F, 0x04, 0x04, 0},
    };
    const char* found = std::strchr(characters, character);
    return rows[found && character ? found - characters : 0];
}

// A picture of `width` x `height` pixels with `channels` bytes each.
struct Canvas {
    uint32_t width;
    uint32_t height;
    int channels;
    std::vector<uint8_t> pixels;

    Canvas(uint32_t w, uint32_t h, int c, uint8_t fill) : width(w), height(h), channels(c), pixels(static_cast<size_t>(w) * h * c, fill) {}

    void fill(int left, int top, int right, int bottom, const uint8_t* colour) {
        for (int y = std::max(top, 0); y < std::min(bottom, static_cast<int>(height)); ++y) {
            for (int x = std::max(left, 0); x < std::min(right, static_cast<int>(width)); ++x) {
                std::memcpy(&pixels[(static_cast<size_t>(y) * width + x) * channels], colour, static_cast<size_t>(channels));
            }
        }
    }

    // Each font pixel becomes a `scale` x `scale` square.
    void text(int x, int y, int scale, const std::string& line, const uint8_t* colour) {
        for (char character : line) {
            const uint8_t* rows = glyph(character);
            for (int row = 0; row < 7; ++row) {
                for (int column = 0; column < 5; ++column) {
                    if (rows[row] & (0x10 >> column)) fill(x + column * scale, y + row * scale, x + (column + 1) * scale, y + (row + 1) * scale, colour);
                }
            }
            x += 6 * scale;
        }
    }

    void rightText(int right, int y, int scale, const std::string& line, const uint8_t* colour) {
        text(right - static_cast<int>(line.size()) * 6 * scale + scale, y, scale, line, colour);
    }
};

// Splits `text` into lines of at most `columns` characters at spaces.
inline std::vector<std::string> wrap(const std::string& text, size_t columns) {
    std::vector<std::string> lines;
    std::string line;
    size_t start = 0;
    while (start < text.size()) {
        size_t end = text.find(' ', start);
        if (end == std::string::npos) end = text.size();
        const std::string word = text.substr(start, end - start);
        if (!line.empty() && line.size() + 1 + word.size() > columns) {
            lines.push_back(line);
            line.clear();
        }
        line += (line.empty() ? "" : " ") + word;
        start = end + 1;
    }
    if (!line.empty()) lines.push_back(line);
    return lines;
}

// The first page of the viewer's sample: a letter, one byte per pixel, 0 black and 255 white.
inline Canvas letter(uint32_t width, uint32_t height) {
    Canvas page(width, height, 1, 255);
    const uint8_t black = 0;
    const int left = static_cast<int>(width) / 10;
    const int right = static_cast<int>(width) - left;
    int y = static_cast<int>(height) / 14;
    page.text(left, y, 9, "CROSSBIND", &black);
    page.rightText(right, y + 6, 3, "SAMPLE FOR LIBTIFF", &black);
    page.rightText(right, y + 36, 3, "24 SEP 2026", &black);
    y += 90;
    page.fill(left, y, right, y + 5, &black);
    y += 60;
    page.text(left, y, 5, "A PAGE FROM A SCANNER", &black);
    y += 80;
    const std::string body =
        "THIS PAGE IS A 1-BIT IMAGE OF 1654 BY 2339 PIXELS, A4 AT 200 DPI, STORED WITH CCITT GROUP 4, THE CODING FAX MACHINES USE. "
        "GROUP 4 KEEPS ONLY WHERE EACH LINE CHANGES FROM THE LINE ABOVE, SO THIS PAGE, 484 KB AS RAW BITS, TAKES UNDER 20 KB. "
        "THE FILE HAS THREE MORE PAGES: A JPEG PHOTO, A 16-BIT MICROSCOPE IMAGE IN ZSTD TILES AND A 32-BIT FLOAT ELEVATION MODEL. "
        "LIBTIFF 4.7.2 WROTE ALL FOUR IN THIS TAB, COMPILED TO WEBASSEMBLY BY CROSSBIND; NOTHING WAS UPLOADED.";
    const size_t columns = static_cast<size_t>((right - left) / 24);
    for (const std::string& line : wrap(body, columns)) {
        page.text(left, y, 4, line, &black);
        y += 48;
    }
    y += 40;
    const char* const rows[][3] = {{"PAGE", "CONTENT", "CODEC"}, {"1", "THIS LETTER, 1 BIT", "CCITT G4"}, {"2", "LANDSCAPE, 8-BIT RGB", "JPEG"},
                                   {"3", "CELLS, 16-BIT GREY", "ZSTD"}, {"4", "ELEVATION, 32-BIT FLOAT", "DEFLATE"}};
    const int cells[] = {left, left + 200, left + 900, right};
    for (int row = 0; row < 5; ++row) {
        page.fill(left, y, right, y + 3, &black);
        for (int column = 0; column < 3; ++column) page.text(cells[column] + 20, y + 22, 4, rows[row][column], &black);
        y += 72;
    }
    page.fill(left, y, right, y + 3, &black);
    for (int edge : cells) page.fill(edge, y - 5 * 72, edge + 3, y + 3, &black);
    y += 120;
    const std::string signature = "NO SIGNATURE: EVERY PIXEL OF THIS PAGE WAS DRAWN BY THE CODE THAT WROTE THE FILE.";
    for (const std::string& line : wrap(signature, columns)) {
        page.text(left, y, 4, line, &black);
        y += 48;
    }
    page.text(left, static_cast<int>(height) - 160, 3, "PAGE 1 OF 4", &black);
    return page;
}

// A landscape: sky, sun, three mountain ranges and a lake that mirrors them. 8-bit RGB.
inline Canvas landscape(uint32_t width, uint32_t height) {
    Canvas picture(width, height, 3, 0);
    const int w = static_cast<int>(width);
    const int h = static_cast<int>(height);
    const int horizon = h * 62 / 100;
    std::vector<int> ridges[3];
    const int bases[3] = {h * 30 / 100, h * 40 / 100, h * 50 / 100};
    const int roughness[3] = {h * 22 / 100, h * 18 / 100, h * 12 / 100};
    Lcg random(1984);
    for (int layer = 0; layer < 3; ++layer) {
        // Midpoint displacement between random end heights, the jitter shrinking at each level.
        const int span = 1 << 11;
        std::vector<int> points(static_cast<size_t>(span) + 1, 0);
        points[0] = static_cast<int>(random.below(static_cast<uint32_t>(roughness[layer])));
        points[span] = static_cast<int>(random.below(static_cast<uint32_t>(roughness[layer])));
        int jitter = roughness[layer];
        for (int step = span; step > 1; step /= 2) {
            for (int at = step / 2; at < span; at += step) {
                points[at] = (points[at - step / 2] + points[at + step / 2]) / 2 + static_cast<int>(random.below(static_cast<uint32_t>(jitter + 1))) - jitter / 2;
            }
            jitter = std::max(1, jitter * 55 / 100);
        }
        ridges[layer].resize(static_cast<size_t>(w));
        for (int x = 0; x < w; ++x) ridges[layer][x] = bases[layer] + points[static_cast<size_t>(x) * span / w];
    }
    const int layers[3][3] = {{128, 146, 176}, {86, 112, 128}, {52, 84, 66}};
    const int sunX = w * 78 / 100;
    const int sunY = h * 20 / 100;
    const int sunR = h * 7 / 100;
    for (int y = 0; y < h; ++y) {
        for (int x = 0; x < w; ++x) {
            const bool water = y >= horizon;
            const int sy = water ? 2 * horizon - y : y;  // the lake mirrors the scene above the horizon
            int colour[3] = {70 + 130 * sy / horizon, 130 + 95 * sy / horizon, 200 + 45 * sy / horizon};
            const int dx = x - sunX;
            const int dy = sy - sunY;
            if (dx * dx + dy * dy < sunR * sunR) {
                colour[0] = 255;
                colour[1] = 236;
                colour[2] = 190;
            }
            for (int layer = 0; layer < 3; ++layer) {
                if (sy >= ridges[layer][x]) {
                    const int shade = (sy - ridges[layer][x]) * 40 / h;
                    for (int c = 0; c < 3; ++c) colour[c] = std::max(0, layers[layer][c] - shade);
                }
            }
            if (water) {
                const bool ripple = (y - horizon) % 9 < 2 && ((x + (y - horizon) * 13) / 40) % 3 == 0;
                for (int c = 0; c < 3; ++c) colour[c] = colour[c] * 72 / 100 + (c == 2 ? 26 : 12) + (ripple ? 18 : 0);
            }
            uint8_t* out = &picture.pixels[(static_cast<size_t>(y) * width + x) * 3];
            for (int c = 0; c < 3; ++c) out[c] = static_cast<uint8_t>(std::min(255, colour[c]));
        }
    }
    return picture;
}

// Fluorescent cells as a 12-bit sensor records them, in 16-bit samples: a dark, noisy background,
// cell bodies, bright nuclei and membranes. Displayed as plain 16-bit data, they are nearly black.
inline std::vector<uint16_t> cells(uint32_t width, uint32_t height, int count, uint32_t seed) {
    std::vector<int32_t> field(static_cast<size_t>(width) * height, 0);
    Lcg random(seed);
    for (size_t i = 0; i < field.size(); ++i) field[i] = 150 + static_cast<int32_t>(random.below(6) + random.below(6)) - 5;
    const int32_t minRadius = static_cast<int32_t>(width) / 36;
    for (int cell = 0; cell < count; ++cell) {
        const int32_t cx = static_cast<int32_t>(random.below(width));
        const int32_t cy = static_cast<int32_t>(random.below(height));
        const int32_t r = minRadius + static_cast<int32_t>(random.below(static_cast<uint32_t>(minRadius) + 1));
        const int32_t body = 500 + static_cast<int32_t>(random.below(700));
        const int32_t nx = cx + r / 5;
        const int32_t ny = cy - r / 6;
        const int32_t nr = r * 2 / 5;
        for (int32_t y = std::max(0, cy - r); y < std::min(static_cast<int32_t>(height), cy + r + 1); ++y) {
            for (int32_t x = std::max(0, cx - r); x < std::min(static_cast<int32_t>(width), cx + r + 1); ++x) {
                const int32_t d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
                if (d2 >= r * r) continue;
                int32_t add = body * (r * r - d2) / (r * r) + (d2 * 4 > r * r * 3 ? 450 : 0);
                const int32_t n2 = (x - nx) * (x - nx) + (y - ny) * (y - ny);
                if (n2 < nr * nr) add += 2100 * (nr * nr - n2) / (nr * nr);
                field[static_cast<size_t>(y) * width + x] += add;
            }
        }
    }
    std::vector<uint16_t> samples(field.size());
    for (size_t i = 0; i < field.size(); ++i) samples[i] = static_cast<uint16_t>(std::min<int32_t>(4095, std::max<int32_t>(0, field[i])));
    return samples;
}

// An elevation model in metres, in steps of 1/16 m so every value is exact in float32: six octaves
// of smoothly interpolated random heights, the look of real terrain, and a little roughness. With
// `withSea`, samples below 350 m become `sea`, a no-data value.
inline std::vector<float> terrain(uint32_t width, uint32_t height, uint32_t seed, bool withSea, float sea) {
    const int64_t octaves[][2] = {{256, 16 * 520}, {128, 16 * 260}, {64, 16 * 130}, {32, 16 * 64}, {16, 16 * 30}, {8, 16 * 14}};
    std::vector<int64_t> sixteenths(static_cast<size_t>(width) * height, 0);
    Lcg random(seed);
    for (const auto& octave : octaves) {
        const int64_t spacing = octave[0];
        const size_t across = width / static_cast<uint32_t>(spacing) + 2;
        const size_t down = height / static_cast<uint32_t>(spacing) + 2;
        std::vector<int64_t> lattice(across * down);
        for (int64_t& value : lattice) value = random.below(static_cast<uint32_t>(octave[1]) + 1);
        for (uint32_t y = 0; y < height; ++y) {
            const int64_t fy = y % spacing;
            const int64_t sy = fy * fy * (3 * spacing - 2 * fy) / (spacing * spacing);  // smoothstep
            for (uint32_t x = 0; x < width; ++x) {
                const int64_t fx = x % spacing;
                const int64_t sx = fx * fx * (3 * spacing - 2 * fx) / (spacing * spacing);
                const int64_t* above = &lattice[(y / spacing) * across + x / spacing];
                const int64_t* below = above + across;
                sixteenths[static_cast<size_t>(y) * width + x] +=
                    (above[0] * (spacing - sx) * (spacing - sy) + above[1] * sx * (spacing - sy) + below[0] * (spacing - sx) * sy + below[1] * sx * sy) / (spacing * spacing);
            }
        }
    }
    std::vector<float> metres(sixteenths.size());
    const int64_t seaLevel = 16 * 350;
    for (size_t i = 0; i < metres.size(); ++i) {
        const int64_t value = sixteenths[i] + static_cast<int64_t>(random.below(5)) - 2;
        metres[i] = withSea && value < seaLevel ? sea : static_cast<float>(value) / 16.0f;
    }
    return metres;
}

// A camera's softness: the [1 2 1] binomial filter across and down, twice, edge pixels repeated.
inline void soften(std::vector<int32_t>& plane, uint32_t width, uint32_t height) {
    std::vector<int32_t> across(plane.size());
    for (int pass = 0; pass < 2; ++pass) {
        for (uint32_t y = 0; y < height; ++y) {
            const int32_t* row = &plane[static_cast<size_t>(y) * width];
            for (uint32_t x = 0; x < width; ++x) {
                const int32_t left = row[x ? x - 1 : 0];
                const int32_t right = row[x + 1 < width ? x + 1 : width - 1];
                across[static_cast<size_t>(y) * width + x] = (left + 2 * row[x] + right + 2) >> 2;
            }
        }
        for (uint32_t y = 0; y < height; ++y) {
            const int32_t* up = &across[static_cast<size_t>(y ? y - 1 : 0) * width];
            const int32_t* here = &across[static_cast<size_t>(y) * width];
            const int32_t* down = &across[static_cast<size_t>(y + 1 < height ? y + 1 : height - 1) * width];
            for (uint32_t x = 0; x < width; ++x) plane[static_cast<size_t>(y) * width + x] = (up[x] + 2 * here[x] + down[x] + 2) >> 2;
        }
    }
}

// A photographed paper page for the scan archiver: warm paper that darkens towards one corner, ink
// that is not quite black, a red stamp and a lens's softness. RGBA, as a canvas holds it.
inline Canvas photographedPage(int index, uint32_t width, uint32_t height) {
    const uint8_t ink[4] = {38, 40, 62, 255};
    const uint8_t red[4] = {186, 44, 40, 255};
    const int left = static_cast<int>(width) / 10;
    const int right = static_cast<int>(width) - left;
    const size_t columns = static_cast<size_t>((right - left) / 18);
    Canvas text(width, height, 4, 0);
    int y = static_cast<int>(height) / 12;
    if (index == 0) {
        text.text(left, y, 7, "INVOICE", ink);
        text.rightText(right, y + 4, 3, "NO. 2026-0924-01", ink);
        text.rightText(right, y + 34, 3, "24 SEP 2026", ink);
        y += 110;
        for (const char* line : {"BILLED TO:", "THE READER OF THIS PAGE", "SOMEWHERE ON THE WEB"}) {
            text.text(left, y, 3, line, ink);
            y += 34;
        }
        y += 34;
        const char* const items[][3] = {{"ITEM", "QTY", "AMOUNT"}, {"TIFF PAGES, CCITT GROUP 4", "2", "0.00"}, {"WEBASSEMBLY BUILD OF LIBTIFF", "1", "0.00"},
                                        {"UPLOADS", "0", "0.00"}, {"TOTAL", "", "0.00"}};
        const int stops[] = {left, right - 360, right - 170, right};
        for (const auto& item : items) {
            text.fill(left, y, right, y + 2, ink);
            for (int column = 0; column < 3; ++column) text.text(stops[column] + 14, y + 18, 3, item[column], ink);
            y += 58;
        }
        text.fill(left, y, right, y + 2, ink);
        y += 80;
        const std::string note = "PAYMENT IS NOT REQUIRED. THIS PAGE WAS DRAWN BY THE MODULE THAT TURNS IT INTO A FAX-GRADE TIFF, SO THE RESULT IS THE SAME ON EVERY MACHINE.";
        for (const std::string& line : wrap(note, columns)) {
            text.text(left, y, 3, line, ink);
            y += 34;
        }
        const int stampTop = static_cast<int>(height) * 70 / 100;
        const int stampLeft = right - 420;
        for (int edge = 0; edge < 6; ++edge) {
            text.fill(stampLeft + edge, stampTop + edge, right - edge, stampTop + edge + 1, red);
            text.fill(stampLeft + edge, stampTop + 150 - edge, right - edge, stampTop + 151 - edge, red);
            text.fill(stampLeft + edge, stampTop + edge, stampLeft + edge + 1, stampTop + 151 - edge, red);
            text.fill(right - edge - 1, stampTop + edge, right - edge, stampTop + 151 - edge, red);
        }
        text.text(stampLeft + 40, stampTop + 40, 6, "RECEIVED", red);
    } else {
        text.text(left, y, 5, "TERMS AND NOTES", ink);
        y += 100;
        const std::string paragraph =
            "A SCANNED PAGE IS MOSTLY PAPER. AFTER A THRESHOLD TURNS EVERY PIXEL BLACK OR WHITE, CCITT GROUP 4 STORES EACH LINE AS THE PLACES WHERE IT "
            "DIFFERS FROM THE LINE ABOVE, WHICH IS WHY FAX MACHINES, COURTS AND DOCUMENT ARCHIVES KEEP BLACK AND WHITE PAGES THIS WAY.";
        for (int repeat = 0; repeat < 4; ++repeat) {
            for (const std::string& line : wrap(paragraph, columns)) {
                text.text(left, y, 3, line, ink);
                y += 34;
            }
            y += 30;
        }
        y += 40;
        text.fill(left, y, left + 480, y + 3, ink);
        text.text(left, y + 20, 3, "SIGNATURE", ink);
    }
    const size_t pixels = static_cast<size_t>(width) * height;
    const int paper[3] = {238, 232, 220};
    std::vector<int32_t> planes[3];
    for (int c = 0; c < 3; ++c) {
        planes[c].resize(pixels);
        for (size_t i = 0; i < pixels; ++i) planes[c][i] = text.pixels[i * 4 + 3] ? text.pixels[i * 4 + c] : paper[c];
        soften(planes[c], width, height);
    }
    Canvas page(width, height, 4, 0);
    const int64_t reach = static_cast<int64_t>(width) * width + static_cast<int64_t>(height) * height;
    Lcg random(7 + static_cast<uint32_t>(index));
    for (uint32_t py = 0; py < height; ++py) {
        for (uint32_t px = 0; px < width; ++px) {
            const size_t at = static_cast<size_t>(py) * width + px;
            const int64_t distance = static_cast<int64_t>(px) * px + static_cast<int64_t>(py) * py;
            const int shade = static_cast<int>(256 - distance * 70 / reach);  // the light falls off towards the far corner
            const int grain = static_cast<int>(random.below(11)) - 5;
            for (int c = 0; c < 3; ++c) page.pixels[at * 4 + c] = static_cast<uint8_t>(std::min(255, std::max(0, planes[c][at] * shade / 256 + grain)));
            page.pixels[at * 4 + 3] = 255;
        }
    }
    return page;
}

}  // namespace art
}  // namespace tiffapps
