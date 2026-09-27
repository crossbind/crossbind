#pragma once

#include <algorithm>
#include <stdexcept>
#include <string>
#include <tuple>
#include <vector>

#include "../support/plausibility.h"
#include "../support/recode.h"
#include "../support/text.h"

// Repairs mojibake: text saved in one encoding and opened as another. For every way the text could
// have been opened wrongly, the doctor turns it back into the bytes it came from, which takes an
// encoder (browsers only have decoders for these), then reads those bytes in every encoding they may
// really have been in. Every step is strict, so a repair exists only when all the bytes fit.
class MojibakeDoctor {
public:
    // Up to maxResults repairs, best first: [{"text","oddities","steps":[{"saved","opened"}]}].
    static std::string repair(const std::string& garbled, int maxResults) {
        plausibility::Commonness commonness;
        const std::vector<char32_t> input = text::codePoints(garbled);
        const int base = plausibility::oddities(input, commonness, plausibility::Language::Any);
        std::vector<Candidate> found;
        for (size_t o = 0; o < openedAs().size(); o += 1) {
            const std::string& opened = openedAs()[o];
            const recode::Result bytes = recode::convert(garbled, "UTF-8", opened, readLikeBrowsers(opened));
            if (!bytes.ok) continue;
            for (size_t s = 0; s < savedAs().size(); s += 1) {
                if (savedAs()[s] == opened) continue;
                recode::Result step = recode::convert(bytes.output, savedAs()[s], "UTF-8");
                // UTF-8 that went through several misconfigured systems carries the same mistake up to
                // three times (Ã©, then ÃƒÂ©); each round must decode strictly.
                const int rounds = savedAs()[s] == "UTF-8" ? 3 : 1;
                for (int times = 1; times <= rounds && step.ok && step.output != garbled; times += 1) {
                    add(found, commonness, step.output, times, s, o);
                    const recode::Result again = recode::convert(step.output, "UTF-8", opened, readLikeBrowsers(opened));
                    if (!again.ok) break;
                    const recode::Result next = recode::convert(again.output, savedAs()[s], "UTF-8");
                    if (!next.ok || next.output == step.output) break;
                    step = next;
                }
            }
        }
        // A repair has to look less odd than the input. A decode that joins bytes into multibyte
        // characters may instead just be shorter: random bytes rarely form valid UTF-8 or valid East
        // Asian double-byte text all the way through, so the decode is itself evidence.
        std::vector<Candidate> better;
        for (const Candidate& candidate : found) {
            const bool shorter = candidate.multibyte && candidate.oddities == base && candidate.length < input.size();
            if (candidate.oddities < base || shorter) better.push_back(candidate);
        }
        std::sort(better.begin(), better.end(), [](const Candidate& a, const Candidate& b) { return a.rank() < b.rank(); });
        std::string json = "[";
        std::vector<std::string> seen;
        for (const Candidate& candidate : better) {
            if (static_cast<int>(seen.size()) >= maxResults) break;
            if (std::find(seen.begin(), seen.end(), candidate.text) != seen.end()) continue;
            seen.push_back(candidate.text);
            const std::string step = "{\"saved\":\"" + savedAs()[candidate.saved] + "\",\"opened\":\"" + openedAs()[candidate.opened] + "\"}";
            std::string steps = step;
            for (int round = 1; round < candidate.times; round += 1) steps += "," + step;
            json += std::string(seen.size() > 1 ? "," : "") + "{\"text\":" + text::json(candidate.text) + ",\"oddities\":" + std::to_string(candidate.oddities) +
                    ",\"steps\":[" + steps + "]}";
        }
        return json + "]";
    }

    // What `text` turns into when its bytes in `saved` are opened as `opened`, the way a browser shows it.
    static std::string garble(const std::string& text, const std::string& saved, const std::string& opened) {
        const recode::Result bytes = recode::convert(text, "UTF-8", saved);
        if (!bytes.ok) throw std::runtime_error(saved + " cannot hold every character of the text");
        const recode::Result shown = recode::convert(bytes.output, opened, "UTF-8", readLikeBrowsers(opened));
        if (!shown.ok) throw std::runtime_error(opened + " has no character for byte " + std::to_string(shown.at) + " (0x" + text::hex(bytes.output.substr(shown.at, 1), 1) + ")");
        return shown.output;
    }

    // The bytes a browser read as `text` in `encoding`, as hex, at most maxBytes; "" when there are none.
    static std::string bytesHex(const std::string& text, const std::string& encoding, int maxBytes) {
        const recode::Result bytes = recode::convert(text, "UTF-8", encoding, readLikeBrowsers(encoding));
        return bytes.ok ? text::hex(bytes.output, static_cast<size_t>(std::max(maxBytes, 0))) : "";
    }

private:
    struct Candidate {
        std::string text;
        int oddities;
        size_t length;
        int times;
        bool multibyte;
        size_t saved;
        size_t opened;
        std::tuple<int, bool, int, size_t, size_t> rank() const { return std::make_tuple(oddities, saved != 0, times, saved, opened); }
    };

    // How text is most often opened by mistake: Windows and DOS code pages, Mac Roman, and the East
    // Asian Windows code pages that read UTF-8 as double-byte characters.
    static const std::vector<std::string>& openedAs() {
        static const std::vector<std::string> list = {"CP1252", "ISO-8859-1", "CP1250", "CP1251", "CP1254", "KOI8-R", "CP866", "CP850", "MACINTOSH", "CP932", "CP936", "CP950", "CP949"};
        return list;
    }

    // What the bytes may really have been, most likely first.
    static const std::vector<std::string>& savedAs() {
        static const std::vector<std::string> list = {"UTF-8", "CP932", "CP949", "CP936", "CP950", "EUC-JP", "CP1251", "KOI8-R", "CP1252", "CP1250", "CP1253", "CP1254", "CP866"};
        return list;
    }

    // The Windows code pages whose undefined bytes browsers show as C1 controls.
    static bool readLikeBrowsers(const std::string& encoding) {
        return encoding == "CP1250" || encoding == "CP1251" || encoding == "CP1252" || encoding == "CP1254";
    }

    static plausibility::Language languageOf(const std::string& encoding) {
        if (encoding == "CP932" || encoding == "EUC-JP") return plausibility::Language::Japanese;
        if (encoding == "CP949") return plausibility::Language::Korean;
        if (encoding == "CP936" || encoding == "CP950") return plausibility::Language::Chinese;
        return plausibility::Language::Any;
    }

    static void add(std::vector<Candidate>& found, plausibility::Commonness& commonness, const std::string& repaired, int times, size_t saved, size_t opened) {
        const std::vector<char32_t> chars = text::codePoints(repaired);
        const plausibility::Language language = languageOf(savedAs()[saved]);
        const bool multibyte = saved == 0 || language != plausibility::Language::Any;
        found.push_back({repaired, plausibility::oddities(chars, commonness, language), chars.size(), times, multibyte, saved, opened});
    }
};
