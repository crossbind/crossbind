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
