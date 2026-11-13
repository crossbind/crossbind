// The licenses of what a page and the app it runs in carry, from the crossbind-licenses.json a build of the page with
// crossbind's Vite or Rollup plugin writes beside it.
const FILE = 'crossbind-licenses.json';

export async function licenses() {
    // Vite gives the base it serves the page from; elsewhere the file is beside the page.
    const url = new URL(`${import.meta.env?.BASE_URL ?? './'}${FILE}`, document.baseURI);
    const response = await fetch(url);
    // A dev server answers a file it lacks with the page.
    const list = response.ok ? await response.json().catch(() => null) : null;
    if (!Array.isArray(list)) {
        throw new Error(`crossbind: ${url} holds no license list. A build of the page with crossbind's Vite or Rollup plugin writes it; the dev server has none.`);
    }
    return list;
}
