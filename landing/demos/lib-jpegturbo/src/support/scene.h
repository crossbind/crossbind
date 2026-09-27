#pragma once

#include <cstdint>
#include <stdexcept>
#include <string>

// The picture every sample in the apps starts from: a landscape drawn with integer arithmetic only,
// so the same pixels come out of every build. It has what JPEG settings are judged on: smooth sky,
// textured hills, fine stripes, saturated patches, and red text on blue, where chroma subsampling
// shows first.
namespace scene {

struct Rect {
    int x, y, w, h;
};

inline uint32_t hash(uint32_t x, uint32_t y) {
    uint32_t h = x * 374761393u + y * 668265263u;
    h = (h ^ (h >> 13)) * 1274126177u;
    return h ^ (h >> 16);
}

// |sawtooth| in 0..amplitude with the given period.
inline int wave(int u, int period, int amplitude) {
    const int phase = ((u % period) + period) % period;
    const int distance = phase * 2 - period;
    return amplitude * (distance < 0 ? -distance : distance) / period;
}

inline int mix(int a, int b, int t, int scale) { return a + (b - a) * t / scale; }

// The blue banner with the red text, in pixels: where a zoomed crop shows subsampling best.
inline Rect banner(int width, int height) { return {width * 7 / 100, height * 64 / 100, width * 41 / 100, height * 12 / 100}; }

inline bool glyph(char letter, int column, int row) {
    static const unsigned char c[7] = {0, 0, 14, 16, 16, 16, 14};
    static const unsigned char r[7] = {0, 0, 22, 25, 16, 16, 16};
    static const unsigned char o[7] = {0, 0, 14, 17, 17, 17, 14};
    static const unsigned char s[7] = {0, 0, 15, 16, 14, 1, 30};
    static const unsigned char b[7] = {16, 16, 22, 25, 17, 17, 30};
    static const unsigned char i[7] = {4, 0, 12, 4, 4, 4, 14};
    static const unsigned char n[7] = {0, 0, 22, 25, 17, 17, 17};
    static const unsigned char d[7] = {1, 1, 13, 19, 17, 17, 15};
    const unsigned char* rows = letter == 'c' ? c : letter == 'r' ? r : letter == 'o' ? o : letter == 's' ? s : letter == 'b' ? b : letter == 'i' ? i : letter == 'n' ? n : d;
    return (rows[row] >> (4 - column)) & 1;
}

// width * height * 3 bytes of RGB.
inline std::string photo(int width, int height) {
    if (width < 64 || height < 64 || width > 16384 || height > 16384) throw std::invalid_argument("the scene is drawn at 64 to 16384 pixels a side");
    std::string rgb(static_cast<size_t>(width) * height * 3, '\0');
    const Rect text = banner(width, height);
    const char* word = "crossbind";
    const int cell = text.w / 56 > 0 ? text.w / 56 : 1;
    const int textX = text.x + (text.w - cell * 53) / 2;
    const int textY = text.y + (text.h - cell * 7) / 2;
    const int sunX = width * 73 / 100;
    const int sunY = height * 22 / 100;
    const long sunR = width / 14;
    const int panelX = width * 55 / 100;
    const int panelSpan = width * 93 / 100 - panelX;
    const int stripesY = height * 66 / 100;
    const int patchesY = height * 80 / 100;
    const int bandHeight = height / 12;
    static const unsigned char patches[6][3] = {{220, 30, 30}, {30, 180, 40}, {30, 50, 210}, {30, 200, 210}, {210, 40, 190}, {240, 220, 30}};
    for (int y = 0; y < height; ++y) {
        const int v = static_cast<int>(static_cast<long>(y) * 4096 / height);
        for (int x = 0; x < width; ++x) {
            const int u = static_cast<int>(static_cast<long>(x) * 4096 / width);
            const uint32_t noise = hash(static_cast<uint32_t>(x), static_cast<uint32_t>(y));
            const int far = 1500 + wave(u + 300, 1100, 350) + wave(u, 470, 120) + static_cast<int>(hash(static_cast<uint32_t>(u / 16), 7) % 40);
            const int near = 2050 + wave(u + 700, 1500, 250) + wave(u, 610, 90) + static_cast<int>(hash(static_cast<uint32_t>(u / 8), 9) % 30);
            int red, green, blue;
            if (v >= 3300) {  // water, with ripples
                const int ripple = static_cast<int>(hash(static_cast<uint32_t>(y / 2), static_cast<uint32_t>(x / 24)) & 31);
                red = 30 + ripple / 2;
                green = 70 + ripple;
                blue = mix(120, 90, v - 3300, 796) + ripple;
            } else if (v >= near) {  // near hills: grass texture, darker downhill
                const int grain = static_cast<int>(noise & 63);
                red = mix(70, 35, v - near, 1300) + grain / 3;
                green = mix(130, 80, v - near, 1300) + grain / 2;
                blue = mix(50, 30, v - near, 1300) + grain / 5;
            } else if (v >= far) {  // far mountains
                const int grain = static_cast<int>(noise & 15);
                red = 95 + grain;
                green = 110 + grain;
                blue = 140 + grain;
            } else {  // sky, with the sun
                red = mix(40, 235, v, 2300);
                green = mix(90, 190, v, 2300);
                blue = mix(170, 150, v, 2300);
                const long dx = x - sunX;
                const long dy = y - sunY;
                const long distance = dx * dx + dy * dy;
                if (distance < sunR * sunR) {
                    red = 255;
                    green = 236;
                    blue = 180;
                } else if (distance < sunR * sunR * 3) {
                    const int glow = static_cast<int>((sunR * sunR * 3 - distance) * 64 / (sunR * sunR * 2));
                    red = mix(red, 255, glow, 64);
                    green = mix(green, 236, glow, 64);
                    blue = mix(blue, 180, glow, 64);
                }
            }
            if (x >= text.x && x < text.x + text.w && y >= text.y && y < text.y + text.h) {
                red = 20;
                green = 40;
                blue = 200;
                const int column = (x - textX) / cell;
                const int row = (y - textY) / cell;
                if (x >= textX && y >= textY && column < 53 && row < 7 && column % 6 < 5 && glyph(word[column / 6], column % 6, row)) {
                    red = 230;
                    green = 25;
                    blue = 35;
                }
            }
            if (x >= panelX && x < panelX + panelSpan && y >= stripesY && y < stripesY + bandHeight) {  // stripes, finer to the right
                const int period = 2 + 10 * (panelX + panelSpan - x) / panelSpan;
                red = green = blue = ((x - panelX) / period) % 2 ? 235 : 20;
            }
            if (x >= panelX && x < panelX + panelSpan && y >= patchesY && y < patchesY + bandHeight) {  // six saturated patches
                const int index = (x - panelX) * 6 / panelSpan;
                red = patches[index][0];
                green = patches[index][1];
                blue = patches[index][2];
            }
            unsigned char* pixel = reinterpret_cast<unsigned char*>(&rgb[(static_cast<size_t>(y) * width + x) * 3]);
            pixel[0] = static_cast<unsigned char>(red < 0 ? 0 : red > 255 ? 255 : red);
            pixel[1] = static_cast<unsigned char>(green < 0 ? 0 : green > 255 ? 255 : green);
            pixel[2] = static_cast<unsigned char>(blue < 0 ? 0 : blue > 255 ? 255 : blue);
        }
    }
    return rgb;
}

}  // namespace scene
