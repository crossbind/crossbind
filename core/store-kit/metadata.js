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

export function singleSource(project, file, source) {
    if (fs.existsSync(file)) throw new Error(`crossbind: both ${source} and ${path.relative(project, file)} define the same field. Keep one source.`);
}

export function stringList(value, source) {
    if (!Array.isArray(value) || !value.length || value.some((item) => typeof item !== 'string' || !item.trim() || /[\r\n]/.test(item))) {
        throw new Error(`crossbind: ${source} must be a nonempty array of single-line strings.`);
    }
    return value.map((item) => item.trim());
}

// A field has the same limits and normalized publisher value through either authoring format.
export function metadataTexts(store, project, folder, source, json, definitions) {
    const texts = {};
    for (const [name, limits] of Object.entries(definitions)) {
        const file = path.join(folder, name);
        const { field } = limits;
        if (Object.hasOwn(json, field)) {
            const label = `${source}.${field}`;
            singleSource(project, file, label);
            texts[field] = checkedText(store, label, json[field], limits);
        } else if (fs.existsSync(file)) {
            texts[field] = readText(store, project, file, limits);
        }
    }
    return texts;
}
