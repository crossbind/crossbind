import fs from 'node:fs';
import path from 'node:path';
import { checkedText, readText } from './index.js';

export function metadataObject(value, source, keys) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`crossbind: ${source} must contain an object.`);
    for (const key of Object.keys(value)) {
        if (!keys.includes(key)) throw new Error(`crossbind: unknown field ${key} in ${source}. Expected one of ${keys.join(', ')}.`);
    }
    return value;
}

export function readMetadata(project, file, keys) {
    if (!fs.existsSync(file)) return {};
    const source = path.relative(project, file);
    let value;
    try {
        value = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        throw new Error(`crossbind: cannot read JSON from ${source}.`, { cause: error });
    }
    return metadataObject(value, source, keys);
}

export function stringList(value, source) {
    if (!Array.isArray(value) || !value.length || value.some((item) => typeof item !== 'string' || !item.trim() || /[\r\n]/.test(item))) {
        throw new Error(`crossbind: ${source} must be a nonempty array of single-line strings.`);
    }
    return value.map((item) => item.trim());
}

// Each field is either a JSON property or a dedicated long-text file.
export function metadataTexts(store, project, file, json, fields) {
    const texts = {};
    for (const [field, limits] of Object.entries(fields)) {
        if (limits.file) {
            const text = path.join(path.dirname(file), limits.file);
            if (fs.existsSync(text)) texts[field] = readText(store, project, text, limits);
        } else if (Object.hasOwn(json, field)) {
            texts[field] = checkedText(store, `${path.relative(project, file)}.${field}`, json[field], limits);
        }
    }
    return texts;
}
