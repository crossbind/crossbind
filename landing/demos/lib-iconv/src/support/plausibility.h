#pragma once

#include <string>
#include <unordered_map>
#include <vector>

#include "recode.h"
#include "text.h"

// How unlike ordinary text a string looks, as a count of oddities; the mojibake doctor ranks its
// repairs by it. Mojibake leaves stray symbols and control characters, box drawing where letters
// were, runs of accented capitals, lowercase-to-uppercase flips inside words, words that switch
// script, and rare CJK characters. A Han character counts as common when the core table of a
// national standard holds it (GB 2312 level 1, JIS X 0208 level 1 or Big5's frequent block), and a
// Hangul syllable when KS X 1001 does; libiconv itself answers both questions.
namespace plausibility {

enum class Script { None, Latin, Greek, Cyrillic, Armenian, Hebrew, Arabic, Thai, Georgian, Hangul, Han, Kana };

// The language an East Asian code page implies; the other encodings imply none.
enum class Language { Any, Japanese, Korean, Chinese };

inline Script scriptOf(char32_t c) {
    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= 0xC0 && c <= 0x24F && c != 0xD7 && c != 0xF7) || (c >= 0x1E00 && c <= 0x1EFF)) return Script::Latin;
    if ((c >= 0x370 && c <= 0x3FF) || (c >= 0x1F00 && c <= 0x1FFF)) return Script::Greek;
    if (c >= 0x400 && c <= 0x52F) return Script::Cyrillic;
    if (c >= 0x530 && c <= 0x58F) return Script::Armenian;
    if (c >= 0x590 && c <= 0x5FF) return Script::Hebrew;
    if ((c >= 0x600 && c <= 0x6FF) || (c >= 0xFB50 && c <= 0xFEFF)) return Script::Arabic;
    if (c >= 0xE00 && c <= 0xEFF) return Script::Thai;
    if (c >= 0x10A0 && c <= 0x10FF) return Script::Georgian;
    if (c >= 0xAC00 && c <= 0xD7AF) return Script::Hangul;
    if ((c >= 0x3040 && c <= 0x30FF) || (c >= 0xFF21 && c <= 0xFF5A)) return Script::Kana;
    if ((c >= 0x3400 && c <= 0x9FFF) || (c >= 0xF900 && c <= 0xFAFF) || (c >= 0x20000 && c <= 0x2FFFF)) return Script::Han;
    return Script::None;
}

// 1 for an uppercase letter, -1 for a lowercase one, 0 when case does not apply or is not tracked.
inline int caseOf(char32_t c) {
    if (c >= 'A' && c <= 'Z') return 1;
    if (c >= 'a' && c <= 'z') return -1;
    if (c >= 0xC0 && c <= 0xDE && c != 0xD7) return 1;
    if (c >= 0xDF && c <= 0xFF && c != 0xF7) return -1;
    // Latin Extended-A pairs capitals with small letters, even-odd except in two runs.
    if (c == 0x138 || c == 0x149 || c == 0x17F) return -1;
    if (c == 0x178) return 1;
    if ((c >= 0x139 && c <= 0x148) || (c >= 0x179 && c <= 0x17E)) return c % 2 ? 1 : -1;
    if (c >= 0x100 && c <= 0x177) return c % 2 ? -1 : 1;
    if (c >= 0x391 && c <= 0x3A9) return 1;
    if (c >= 0x3B1 && c <= 0x3C9) return -1;
    if (c >= 0x400 && c <= 0x42F) return 1;
    if (c >= 0x430 && c <= 0x45F) return -1;
    return 0;
}

// Characters that mojibake produces and ordinary text rarely holds: Latin-1 symbols other than the
// punctuation languages use, the Windows-1252 oddments, ligatures such as Ĳ, math operators, and the
// CJK compatibility blocks (loose jamo, squared units) that East Asian code pages put near letters.
inline bool isOddSymbol(char32_t c) {
    switch (c) {
        case 0xA1: case 0xA3: case 0xA7: case 0xA9: case 0xAB: case 0xAE: case 0xB0: case 0xB6: case 0xB7: case 0xBB: case 0xBF:
            return false;
        case 0xD7: case 0xF7: case 0x132: case 0x133: case 0x13F: case 0x140: case 0x149: case 0x192: case 0x2C6: case 0x2DC:
        case 0x2020: case 0x2021: case 0x2030: case 0x2039: case 0x203A: case 0x2122:
            return true;
        default:
            return (c >= 0xA2 && c <= 0xBE) || (c >= 0x2200 && c <= 0x22FF) || (c >= 0x3130 && c <= 0x318F) || (c >= 0x3200 && c <= 0x33FF);
    }
}

class Commonness {
public:
    bool isCommon(char32_t c) {
        const auto found = cache.find(c);
        if (found != cache.end()) return found->second;
        const std::string character = text::utf8(c);
        bool common = false;
        if (c >= 0xAC00 && c <= 0xD7A3) {
            common = recode::run(eucKr, character).ok;
        } else {
            common = leadIn(recode::run(eucCn, character), 0xB0, 0xD7) || leadIn(recode::run(eucJp, character), 0xB0, 0xCF) || leadIn(recode::run(big5, character), 0xA4, 0xC6);
        }
        cache.emplace(c, common);
        return common;
    }

private:
    static bool leadIn(const recode::Result& result, unsigned char low, unsigned char high) {
        if (!result.ok || result.output.size() != 2) return false;
        const auto lead = static_cast<unsigned char>(result.output[0]);
        return lead >= low && lead <= high;
    }

    recode::Descriptor eucCn{"EUC-CN", "UTF-8"};
    recode::Descriptor eucJp{"EUC-JP", "UTF-8"};
    recode::Descriptor big5{"BIG5", "UTF-8"};
    recode::Descriptor eucKr{"EUC-KR", "UTF-8"};
    std::unordered_map<char32_t, bool> cache;
};

// Han and kana mix freely in Japanese; every other change of script inside a word is odd.
inline bool mixesWith(Script a, Script b) { return a != b && !((a == Script::Han && b == Script::Kana) || (a == Script::Kana && b == Script::Han)); }

inline int oddities(const std::vector<char32_t>& chars, Commonness& commonness, Language language) {
    int odd = 0;
    Script previousScript = Script::None;
    int previousCase = 0;
    int wordLength = 0;
    int accented = 0;
    int han = 0;
    int kana = 0;
    int hangul = 0;
    const auto endWord = [&]() {
        if (accented >= 3 && accented * 2 > wordLength) odd += accented;
        wordLength = 0;
        accented = 0;
    };
    for (size_t i = 0; i < chars.size(); i += 1) {
        const char32_t c = chars[i];
        if ((c < 0x20 && c != '\t' && c != '\n' && c != '\r') || (c >= 0x7F && c <= 0x9F) || c == 0xFFFD || (c >= 0xE000 && c <= 0xF8FF)) odd += 3;
        if (isOddSymbol(c)) odd += 1;
        if (c >= 0x2500 && c <= 0x259F) odd += 2;
        if (c >= 0xFF61 && c <= 0xFF9F) odd += 1;
        // Latin Extended-B is rare outside a few languages; Romanian's comma-below letters are common.
        if (c >= 0x180 && c <= 0x24F && !(c >= 0x218 && c <= 0x21B)) odd += 1;
        // A combining accent belongs on a letter.
        if (c >= 0x300 && c <= 0x36F && (i == 0 || scriptOf(chars[i - 1]) == Script::None)) odd += 2;
        const Script script = scriptOf(c);
        han += script == Script::Han;
        kana += script == Script::Kana;
        hangul += script == Script::Hangul;
        if ((script == Script::Han || script == Script::Hangul) && !commonness.isCommon(c)) odd += 1;
        // Chinese and Japanese do not put spaces between words.
        if (c == ' ' && i > 0 && i + 1 < chars.size() && language != Language::Korean) {
            const Script before = scriptOf(chars[i - 1]);
            const Script after = scriptOf(chars[i + 1]);
            if ((before == Script::Han || before == Script::Kana) && (after == Script::Han || after == Script::Kana)) odd += 1;
        }
        if (script == Script::None) {
            endWord();
            previousScript = Script::None;
            previousCase = 0;
            continue;
        }
        const int letterCase = caseOf(c);
        if (previousScript != Script::None && mixesWith(previousScript, script)) odd += 2;
        if (previousScript == script && previousCase < 0 && letterCase > 0) odd += 1;
        wordLength += 1;
        if (c >= 0xC0 && c <= 0xFF) accented += 1;
        previousScript = script;
        previousCase = letterCase;
    }
    endWord();
    // What each language's text looks like: Korean is mostly Hangul, and Chinese has neither kana nor Hangul.
    if (language == Language::Korean && han > 0 && hangul == 0) odd += 2;
    if (language == Language::Chinese) odd += kana + hangul;
    return odd;
}

}  // namespace plausibility
