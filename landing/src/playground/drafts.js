import { FILE_NAME } from '../../../tooling/cloud/compiler/validate.js';
import {
    MAIN, packageOf, samePackages, sameProject,
} from './project.js';

// Edits kept per sample in this browser, one storage key per page. A draft holds only what differs from its sample:
// the files edited or added, the sample's files deleted, and the package list once it changed. So a later fix to a
// sample's other files still reaches whoever edited one of them. Every change is applied to what is stored at that
// moment rather than to the page's own copy, so two open tabs keep each other's drafts. Storage can be blocked, as in
// private windows; a page then starts from the samples. No Vite-only imports, so the tests can load this file.

// The playground's key; the tutorial's "Open in playground" writes a step's draft there too.
export const PLAYGROUND_DRAFT_KEY = 'crossbind.playground.project';

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

export const without = (object, key) => Object.fromEntries(Object.entries(object).filter(([name]) => name !== key));

// The draft that turns `sample`'s project into `project`, or null when the two are the same.
export function draftOf(project, sample) {
    const original = sample.project;
    const files = Object.fromEntries(Object.entries(project.files).filter(([name, text]) => text !== original.files[name]));
    const removed = Object.keys(original.files).filter((name) => !(name in project.files));
    const draft = {
        ...(Object.keys(files).length ? { files } : {}),
        ...(removed.length ? { removed } : {}),
        ...(samePackages(project.packages, original.packages) ? {} : { packages: [...project.packages] }),
    };
    return Object.keys(draft).length ? draft : null;
}

export function projectOf(sample, draft) {
    const original = sample.project;
    if (!draft) return original;
    const removed = new Set(draft.removed ?? []);
    const kept = Object.fromEntries(Object.entries(original.files).filter(([name]) => !removed.has(name)));
    return { files: { ...kept, ...draft.files }, packages: draft.packages ?? original.packages };
}

// The part of a stored draft the page can use: text files under names the compiler takes, and packages it knows.
function parseDraft(value, sample) {
    if (!isObject(value)) return null;
    const files = Object.fromEntries(Object.entries(isObject(value.files) ? value.files : {})
        .filter(([name, text]) => FILE_NAME.test(name) && typeof text === 'string'));
    const removed = Array.isArray(value.removed) ? value.removed.filter((name) => name !== MAIN && Object.hasOwn(sample.project.files, name)) : [];
    const packages = Array.isArray(value.packages) ? [...new Set(value.packages.filter((id) => typeof id === 'string' && packageOf(id)))] : null;
    return draftOf(projectOf(sample, { files, removed, ...(packages ? { packages } : {}) }), sample);
}

// What a stored value holds for `samples`: the drafts that still apply and the sample shown last.
export function parseDrafts(stored, samples) {
    const find = (id) => samples.find((sample) => sample.id === id);
    const entries = Object.entries(isObject(stored?.drafts) ? stored.drafts : {}).flatMap(([id, value]) => {
        const sample = find(id);
        const draft = sample ? parseDraft(value, sample) : null;
        return draft ? [[id, draft]] : [];
    });
    return { sample: find(stored?.sample)?.id, drafts: Object.fromEntries(entries) };
}

export function readDrafts(storageKey, samples) {
    try {
        return parseDrafts(JSON.parse(localStorage.getItem(storageKey) ?? 'null'), samples);
    } catch {
        return { sample: undefined, drafts: {} };
    }
}

export function updateDrafts(storageKey, samples, change) {
    try {
        localStorage.setItem(storageKey, JSON.stringify(change(readDrafts(storageKey, samples))));
    } catch {
        // Not stored; the code stays on the page.
    }
}

// Whether `drafts` hold edits of `sample` other than `draft`'s, which handing `draft` over would replace.
export const replacesEdits = (drafts, sample, draft) => Boolean(drafts[sample.id])
    && !sameProject(projectOf(sample, drafts[sample.id]), projectOf(sample, draft));

// `change` applied to `sample`'s project as `drafts` hold it: the draft keeps what then differs, and goes once
// nothing does.
export function editDraft(drafts, sample, change) {
    const draft = draftOf(change(projectOf(sample, drafts[sample.id])), sample);
    return draft ? { ...drafts, [sample.id]: draft } : without(drafts, sample.id);
}
