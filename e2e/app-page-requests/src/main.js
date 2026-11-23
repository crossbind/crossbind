import { STEPS } from '../e2e/steps.mjs';

// The page's dialogs, which the host's own page-dialogs shows and e2e/run.mjs answers, then a permission the host's own
// page-permissions denies without asking, as app.permissions lists none; then the page of the origin e2e-served, whose
// end brings this page back, which logs what it got.
const kept = sessionStorage.getItem('e2e-got');
if (kept) {
    console.log(`RESULT ${JSON.stringify({ ...JSON.parse(kept), served: 'back' })}`);
} else {
    const got = STEPS.map(({ ask, text }) => {
        if (ask === 'alert') return alert('Alert') ?? null;
        return ask === 'confirm' ? confirm('Confirm?') : prompt('Prompt?', text);
    });
    Notification.requestPermission().then((notification) => {
        sessionStorage.setItem('e2e-got', JSON.stringify({ got, notification }));
        location.href = navigator.userAgent.includes('Windows') ? 'http://e2e-served.localhost/' : 'crossbind://e2e-served/';
    });
}
