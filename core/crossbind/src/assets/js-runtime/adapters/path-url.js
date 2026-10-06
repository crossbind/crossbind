// A path with no scheme and no leading slash is relative to the page, as `path: './dist'` is. A worker has no
// page, so the main thread hands it the path resolved.
export default {
    getDefaultPathPrefix: () => '/',
    finalizePath(output) {
        if (/^[a-z][a-z\d+.-]*:/i.test(output) || output[0] === '/') {
            return output;
        }
        return new URL(output, document.baseURI).href;
    },
};
