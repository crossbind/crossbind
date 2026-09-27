#pragma once

#include <cstdint>
#include <vector>

// The images the apps start from, drawn with integer arithmetic so every browser gets the same bytes,
// and so does the Python reference that produced the expected numbers.
namespace samples {

class Lcg {
public:
    explicit Lcg(uint32_t seed) : state(seed) {}
    // Park-Miller, the generator the usage examples write in JavaScript.
    uint32_t below(uint32_t n) {
        state = static_cast<uint32_t>((static_cast<uint64_t>(state) * 48271u) % 2147483647u);
        return state % n;
    }

private:
    uint32_t state;
};

inline int clamp(int value) { return value < 0 ? 0 : value > 255 ? 255 : value; }

// 512x384, opaque: colour bars, a zone plate, the examples' landscape with a little noise, a grey
// ramp and line pairs, each a different kind of content for the encoder.
constexpr int kCardWidth = 512;
constexpr int kCardHeight = 384;

inline std::vector<uint8_t> testCard() {
    static const uint8_t bars[8][3] = {{245, 245, 245}, {245, 245, 15}, {15, 245, 245}, {15, 245, 15}, {245, 15, 245}, {245, 15, 15}, {15, 15, 245}, {15, 15, 15}};
    std::vector<uint8_t> rgba(static_cast<size_t>(kCardWidth) * kCardHeight * 4);
    Lcg random(1);
    for (int y = 0; y < kCardHeight; ++y) {
        for (int x = 0; x < kCardWidth; ++x) {
            int r = 0;
            int g = 0;
            int b = 0;
            if (y < 48) {
                r = bars[x >> 6][0];
                g = bars[x >> 6][1];
                b = bars[x >> 6][2];
            } else if (y < 304 && x < 256) {
                const int dx = x - 128;
                const int dy = y - 176;
                const int phase = ((dx * dx + dy * dy) >> 3) & 255;
                r = g = b = phase < 128 ? phase * 2 : 511 - phase * 2;
            } else if (y < 304) {
                const int lx = x - 256;
                const int ly = y - 48;
                const bool sun = (lx - 180) * (lx - 180) + (ly - 70) * (ly - 70) < 900;
                const bool hill = ly > 170 + (((lx - 128) * (lx - 128)) >> 8);
                if (sun) {
                    r = 255, g = 214, b = 90;
                } else if (hill) {
                    r = 40 + (ly >> 2), g = 120 + (lx >> 3), b = 50;
                } else {
                    r = 90 + (ly >> 1), g = 150 + (ly >> 2), b = 235;
                }
                r ^= static_cast<int>(random.below(8));
                g ^= static_cast<int>(random.below(8));
                b ^= static_cast<int>(random.below(8));
            } else if (y < 344) {
                r = g = b = x >> 1;
            } else if (x < 128) {
                r = g = b = (x & 1) ? 255 : 0;
            } else if (x < 256) {
                r = g = b = ((x >> 1) & 1) ? 255 : 0;
            } else if (x < 384) {
                r = g = b = (y & 1) ? 255 : 0;
            } else if (((x >> 2) ^ (y >> 2)) & 1) {
                r = 230, g = 40, b = 40;
            } else {
                r = 40, g = 200, b = 230;
            }
            uint8_t* pixel = &rgba[(static_cast<size_t>(y) * kCardWidth + x) * 4];
            pixel[0] = static_cast<uint8_t>(r);
            pixel[1] = static_cast<uint8_t>(g);
            pixel[2] = static_cast<uint8_t>(b);
            pixel[3] = 255;
        }
    }
    return rgba;
}

// 600x400 with a transparent background: a smiley with a soft edge, the kind of art a sticker starts as.
constexpr int kSmileyWidth = 600;
constexpr int kSmileyHeight = 400;

inline std::vector<uint8_t> smiley() {
    std::vector<uint8_t> rgba(static_cast<size_t>(kSmileyWidth) * kSmileyHeight * 4, 0);
    for (int y = 0; y < kSmileyHeight; ++y) {
        for (int x = 0; x < kSmileyWidth; ++x) {
            const int dx = x - 300;
            const int dy = y - 200;
            const int d2 = dx * dx + dy * dy;
            if (d2 >= 29241) continue;
            const int alpha = d2 < 28224 ? 255 : (29241 - d2) * 255 / 1017;
            const int shade = (dx + dy) >> 3;
            int r = 255;
            int g = clamp(205 - shade);
            int b = clamp(70 - (shade >> 1));
            if (d2 >= 25600) r = 150, g = 90, b = 20;
            for (const int eye : {240, 360}) {
                const int ex = x - eye;
                const int ey = y - 150;
                if (ex * ex * 1156 + ey * ey * 484 < 559504) r = 70, g = 40, b = 15;
            }
            if (y > 222 && d2 >= 9025 && d2 < 13225) r = 70, g = 40, b = 15;
            for (const int cheek : {205, 395}) {
                if ((x - cheek) * (x - cheek) + (y - 228) * (y - 228) < 484) r = 255, g = 150, b = 120;
            }
            uint8_t* pixel = &rgba[(static_cast<size_t>(y) * kSmileyWidth + x) * 4];
            pixel[0] = static_cast<uint8_t>(r);
            pixel[1] = static_cast<uint8_t>(g);
            pixel[2] = static_cast<uint8_t>(b);
            pixel[3] = static_cast<uint8_t>(alpha);
        }
    }
    return rgba;
}

}  // namespace samples
