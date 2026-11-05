import { STEPS } from '../e2e/steps.mjs';

// The page's dialogs, which the host's own page-dialogs shows and e2e/run.mjs answers, then a permission the host's own
// page-permissions denies without asking, as app.permissions lists none.
const got = STEPS.map(({ ask, text }) => {
    if (ask === 'alert') return alert('Alert') ?? null;
    return ask === 'confirm' ? confirm('Confirm?') : prompt('Prompt?', text);
});
Notification.requestPermission().then((notification) => {
    console.log(`RESULT ${JSON.stringify({ got, notification })}`);
});
