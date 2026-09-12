// The announcement bar is one string for every page; this resolves its first link to the same
// path on crossbind.dev at click time, so it follows the reader through client-side navigation.
// The trailing slash is dropped because the new site's redirect rules are written without one.
document.addEventListener('click', (event) => {
    const link = event.target.closest('#cppjs-new-site');
    if (link) link.href = `https://crossbind.dev${location.pathname.replace(/\/+$/, '')}`;
});
