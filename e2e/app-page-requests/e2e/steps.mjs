// The page's dialogs in the order it opens them, how e2e/run.mjs answers each as the app's user would, and what the
// page then gets.
export const STEPS = [
    { ask: 'confirm', answer: 'ok', expected: true },
    { ask: 'confirm', answer: 'cancel', expected: false },
    { ask: 'prompt', text: 'Öffnen 😀', answer: 'ok', expected: 'Öffnen 😀' },
    { ask: 'prompt', text: 'Öffnen', answer: 'type', typed: 'e2e', expected: 'e2e' },
    { ask: 'prompt', answer: 'cancel', expected: null },
    { ask: 'alert', answer: 'ok', expected: null },
];

// Then the page of an origin the app serves, as a project's, whose alert its label titles; the origin ends while the
// alert waits, which closes it unanswered, and the app's page comes back.
export const SERVED = { label: 'crossbind e2e served' };
