// Property lists as Apple's tools read them: XML for an Info.plist, the older text form for an Xcode project.

const XML_INDENT = '    ';
const escapeXml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function xmlLines(value, indent) {
    if (typeof value === 'boolean') return [`${indent}<${value}/>`];
    if (typeof value === 'number') {
        // An integer an integer element reads back the same, and any other number a real.
        const type = Number.isSafeInteger(value) ? 'integer' : 'real';
        return [`${indent}<${type}>${value}</${type}>`];
    }
    const inner = indent + XML_INDENT;
    if (Array.isArray(value)) return [`${indent}<array>`, ...value.flatMap((item) => xmlLines(item, inner)), `${indent}</array>`];
    if (typeof value === 'object') {
        const entries = Object.entries(value);
        if (entries.length === 0) return [`${indent}<dict/>`];
        return [
            `${indent}<dict>`,
            ...entries.flatMap(([key, item]) => [`${inner}<key>${escapeXml(key)}</key>`, ...xmlLines(item, inner)]),
            `${indent}</dict>`,
        ];
    }
    return [`${indent}<string>${escapeXml(value)}</string>`];
}

export function xmlPlist(dict) {
    return '<?xml version="1.0" encoding="UTF-8"?>\n'
        + '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
        + `<plist version="1.0">\n${xmlLines(dict, '').join('\n')}\n</plist>\n`;
}

// Every value of the text form is a string, quoted here whatever it holds.
const quote = (text) => `"${String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

function textValue(value, indent) {
    const inner = `${indent}\t`;
    if (Array.isArray(value)) return `(\n${value.map((item) => `${inner}${textValue(item, inner)},\n`).join('')}${indent})`;
    if (typeof value === 'object') {
        return `{\n${Object.entries(value).map(([key, item]) => `${inner}${quote(key)} = ${textValue(item, inner)};\n`).join('')}${indent}}`;
    }
    return quote(value);
}

export function textPlist(root) {
    return `// !$*UTF8*$!\n${textValue(root, '')}\n`;
}
