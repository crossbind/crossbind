#pragma once

#include <cstdlib>
#include <stdexcept>
#include <string>
#include <vector>

#include "../support/recode.h"
#include "../support/text.h"

// Writes rows of text in the byte-exact form a legacy system imports. Each character goes through the
// descriptor on its own, so the export knows which bytes belong to which character: it can name every
// character the target lacks, pad fixed-width fields by bytes without splitting a character, and find
// 0x5C inside double-byte characters (Shift_JIS ソ is 83 5C), which breaks software that reads 0x5C
// as a backslash. Records end with CRLF.
class LegacyExport {
public:
    // policy: "" (stop at characters the target lacks), "TRANSLIT" or "IGNORE". widths: "" for the text
    // as it is, or byte widths such as "20,12,10" to lay comma-separated fields out in fixed columns.
    // JSON: {"bytes","utf8Bytes","records","changed","problems":[{"line","column","character","code"}],
    // "backslashes":[{"line","column","character"}],"truncated":[{"line","field"}],"preview":[[[character,hex],...],...]}
    static std::string report(const std::string& rows, const std::string& encoding, const std::string& policy, const std::string& widths) {
        const Export out = build(rows, encoding, policy, widths);
        std::string preview = "[";
        for (size_t r = 0; r < out.preview.size(); r += 1) {
            preview += r ? ",[" : "[";
            for (size_t c = 0; c < out.preview[r].size(); c += 1) {
                preview += std::string(c ? "," : "") + "[" + text::json(out.preview[r][c].first) + ",\"" + out.preview[r][c].second + "\"]";
            }
            preview += "]";
        }
        return "{\"bytes\":" + std::to_string(out.bytes.size()) + ",\"utf8Bytes\":" + std::to_string(out.utf8Bytes) + ",\"records\":" + std::to_string(out.records) +
               ",\"changed\":" + std::to_string(out.changed) + ",\"problems\":[" + join(out.problems) + "],\"backslashes\":[" + join(out.backslashes) +
               "],\"truncated\":[" + join(out.truncated) + "],\"preview\":" + preview + "]}";
    }

    // The file itself. With the default policy it refuses to write a file that lost characters.
    static std::u16string file(const std::string& rows, const std::string& encoding, const std::string& policy, const std::string& widths) {
        const Export out = build(rows, encoding, policy, widths);
        if (!out.problems.empty()) throw std::runtime_error(std::to_string(out.problems.size()) + " character(s) have no " + encoding + " form; choose TRANSLIT or IGNORE, or edit them");
        return text::toUnits(out.bytes);
    }

private:
    struct Export {
        std::string bytes;
        size_t utf8Bytes = 0;
        size_t records = 0;
        size_t changed = 0;
        std::vector<std::string> problems;
        std::vector<std::string> backslashes;
        std::vector<std::string> truncated;
        std::vector<std::vector<std::pair<std::string, std::string>>> preview;
    };

    static constexpr size_t PREVIEW_RECORDS = 3;
    static constexpr size_t LISTED = 50;

    static std::string join(const std::vector<std::string>& items) {
        std::string out;
        for (size_t i = 0; i < items.size(); i += 1) out += (i ? "," : "") + items[i];
        return out;
    }

    static std::vector<std::string> split(const std::string& value, char separator) {
        std::vector<std::string> parts;
        size_t start = 0;
        for (;;) {
            const size_t end = value.find(separator, start);
            parts.push_back(value.substr(start, end == std::string::npos ? std::string::npos : end - start));
            if (end == std::string::npos) return parts;
            start = end + 1;
        }
    }

    static std::vector<size_t> parseWidths(const std::string& widths) {
        std::vector<size_t> out;
        if (widths.empty()) return out;
        for (const std::string& part : split(widths, ',')) {
            const long width = std::strtol(part.c_str(), nullptr, 10);
            if (width < 1 || width > 1000) throw std::invalid_argument("a field width must be between 1 and 1000 bytes: " + part);
            out.push_back(static_cast<size_t>(width));
        }
        return out;
    }

    static Export build(const std::string& rows, const std::string& encoding, const std::string& policy, const std::string& widths) {
        if (policy != "" && policy != "TRANSLIT" && policy != "IGNORE") throw std::invalid_argument("policy must be empty, TRANSLIT or IGNORE");
        const std::vector<size_t> columns = parseWidths(widths);
        recode::Descriptor cd(policy.empty() ? encoding : encoding + "//" + policy, "UTF-8");
        if (!cd.valid()) throw std::invalid_argument("iconv cannot encode to " + encoding);
        Export out;
        std::vector<std::string> lines = split(rows, '\n');
        if (!lines.empty() && lines.back().empty()) lines.pop_back();
        for (size_t l = 0; l < lines.size(); l += 1) {
            std::string line = lines[l];
            if (!line.empty() && line.back() == '\r') line.pop_back();
            out.utf8Bytes += line.size() + 2;
            std::vector<std::pair<std::string, std::string>> shown;
            if (columns.empty()) {
                size_t column = 0;
                out.bytes += encodeRun(cd, line, l + 1, column, out, shown);
            } else {
                const std::vector<std::string> fields = split(line, ',');
                if (fields.size() > columns.size()) {
                    throw std::invalid_argument("line " + std::to_string(l + 1) + " has " + std::to_string(fields.size()) + " fields; the layout has " + std::to_string(columns.size()));
                }
                size_t column = 0;
                for (size_t f = 0; f < columns.size(); f += 1) {
                    const std::string field = f < fields.size() ? fields[f] : "";
                    out.bytes += fit(cd, field, columns[f], l + 1, f + 1, column, out, shown);
                    column += 1;  // the comma that separated the fields
                }
            }
            out.bytes += "\r\n";
            out.records += 1;
            if (out.preview.size() < PREVIEW_RECORDS) out.preview.push_back(shown);
        }
        return out;
    }

    // Converts one character; false when the target has no form for it (the problem is recorded).
    static bool encodeOne(recode::Descriptor& cd, const std::string& character, size_t line, size_t column, Export& out, std::string& bytes) {
        const recode::Result result = recode::run(cd, character);
        if (!result.ok) {
            const std::vector<char32_t> code = text::codePoints(character);
            if (out.problems.size() < LISTED) {
                out.problems.push_back("{\"line\":" + std::to_string(line) + ",\"column\":" + std::to_string(column + 1) + ",\"character\":" + text::json(character) +
                                       ",\"code\":\"" + text::codeName(code.empty() ? 0 : code[0]) + "\"}");
            }
            return false;
        }
        out.changed += result.changed;
        bytes = result.output;
        // A transliteration (€ as EUR) is several characters, not one multibyte character.
        for (size_t i = 1; i < bytes.size() && result.changed == 0; i += 1) {
            if (bytes[i] == '\\' && out.backslashes.size() < LISTED) {
                out.backslashes.push_back("{\"line\":" + std::to_string(line) + ",\"column\":" + std::to_string(column + 1) + ",\"character\":" + text::json(character) + "}");
                break;
            }
        }
        return true;
    }

    static std::string encodeRun(recode::Descriptor& cd, const std::string& value, size_t line, size_t& column, Export& out, std::vector<std::pair<std::string, std::string>>& shown) {
        std::string written;
        for (size_t at = 0; at < value.size(); column += 1) {
            const std::string character = value.substr(at, text::sequenceLength(static_cast<unsigned char>(value[at])));
            at += character.size();
            std::string bytes;
            if (encodeOne(cd, character, line, column, out, bytes)) written += bytes;
            shown.emplace_back(character, text::hex(bytes, bytes.size()));
        }
        return written;
    }

    // One fixed-width field: whole characters while they fit, then spaces up to the width.
    static std::string fit(recode::Descriptor& cd, const std::string& value, size_t width, size_t line, size_t field, size_t& column, Export& out,
                           std::vector<std::pair<std::string, std::string>>& shown) {
        std::string written;
        bool cut = false;
        for (size_t at = 0; at < value.size(); column += 1) {
            const std::string character = value.substr(at, text::sequenceLength(static_cast<unsigned char>(value[at])));
            at += character.size();
            std::string bytes;
            if (!encodeOne(cd, character, line, column, out, bytes)) {
                shown.emplace_back(character, "");
                continue;
            }
            if (cut || written.size() + bytes.size() > width) {
                cut = true;
                continue;
            }
            written += bytes;
            shown.emplace_back(character, text::hex(bytes, bytes.size()));
        }
        if (cut && out.truncated.size() < LISTED) out.truncated.push_back("{\"line\":" + std::to_string(line) + ",\"field\":" + std::to_string(field) + "}");
        if (written.size() < width) {
            const size_t padding = width - written.size();
            written.append(padding, ' ');
            shown.emplace_back(std::string(padding, ' '), text::hex(std::string(padding, ' '), padding));
        }
        return written;
    }
};
