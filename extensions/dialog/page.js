import { checkedOptions, invoke } from 'crossbind/app/core';

// The system's dialogs that pick files or show a message, as a page calls them.
const isFilters = (value) => Array.isArray(value) && value.every((filter) => typeof filter?.name === 'string'
    && Array.isArray(filter.extensions) && filter.extensions.every((extension) => typeof extension === 'string'));

// Spread reads a hole as undefined, which every() skips.
const isButtons = (value) => Array.isArray(value) && value.length >= 1 && value.length <= MAX_BUTTONS
    && [...value].every((label) => typeof label === 'string' && label !== '');

const FILTERS = { isFitting: isFilters, name: 'list of { name, extensions }' };
const BUTTONS = { isFitting: isButtons, name: 'list of one to three labels' };
const OPEN = { title: 'string', defaultPath: 'string', filters: FILTERS, directory: 'boolean', multiple: 'boolean' };
const SAVE = { title: 'string', defaultPath: 'string', defaultName: 'string', filters: FILTERS };
const MESSAGE = { message: 'string', detail: 'string', kind: 'string', buttons: BUTTONS };
const MESSAGE_KINDS = ['info', 'warning', 'error'];
// Android's dialogs take three buttons at most.
const MAX_BUTTONS = 3;

function checkedMessage(options) {
    checkedOptions('dialog.message', options, MESSAGE);
    if (!options.message) throw new TypeError('crossbind: dialog.message takes a message.');
    if (options.kind !== undefined && !MESSAGE_KINDS.includes(options.kind)) {
        throw new TypeError(`crossbind: dialog.message's kind is info, warning or error, not ${JSON.stringify(options.kind)}.`);
    }
    return options;
}

export const dialog = {
    // The paths of the files or folders the user picked, or null when they cancelled.
    open: async (options = {}) => invoke('dialog.open', checkedOptions('dialog.open', options, OPEN)),
    // The path the user chose to save to, or null when they cancelled.
    save: async (options = {}) => invoke('dialog.save', checkedOptions('dialog.save', options, SAVE)),
    // The index of the button the user clicked: Return gives the first, and Escape or closing the dialog the last.
    message: async (options) => invoke('dialog.message', checkedMessage(options)),
};

