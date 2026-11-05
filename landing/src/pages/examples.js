import TEMPLATE_MANIFEST from '../../../tooling/create-app/src/manifest.json' with { type: 'json' };
import { APP_LIST } from '../apps/appList.js';
import { REPO_URL } from '../data.js';
import { isLive } from '../live/runtime.js';
import { CATEGORY_LABELS, PORTS } from '../ports/catalog.js';
import { RELEASE } from '../release.js';

// /examples/: a start for every create-crossbind template, then every library app with a picture of what it shows,
// by the catalog's categories. All of it is derived, so none of it goes stale: the templates from create-crossbind's
// own manifest, the apps from apps/appList.js, their categories and libraries from the ports catalog, and the
// pictures from the apps themselves (scripts/site/capture-app-previews.mjs). ExamplesPage.jsx lays it out; the
// blocks below are what search and llms.txt read.

const portOf = (family) => PORTS.find((port) => port.family === family);
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const groupApps = (apps) => Object.entries(CATEGORY_LABELS)
    .map(([category, label]) => ({
        id: slug(label),
        label,
        apps: apps.filter((app) => portOf(app.family)?.category === category).map((app) => ({
            ...app,
            library: portOf(app.family).name,
            href: `/ports/${app.family}/#${app.id}`,
        })),
    }))
    .filter((group) => group.apps.length > 0);

// An app is listed where its library's module was built into the site, as on the library's own page.
const LIVE_APPS = APP_LIST.filter((app) => isLive(`lib-${app.family}`));
export const APP_GROUPS = groupApps(LIVE_APPS);
export const APP_COUNT = LIVE_APPS.length;
export const LIBRARY_COUNT = new Set(LIVE_APPS.map((app) => app.family)).size;

// create-crossbind's groups, named as a reader looks for them.
const GROUP_LABELS = [['Web', 'Web'], ['Backend', 'Node.js'], ['Mobile', 'Mobile'], ['Desktop', 'Desktop'], ['Cloud', 'Edge'], ['Native', 'Executable'], ['Library', 'Library'], ['Extension', 'Extension']];
// The folder a command scaffolds, whose name a library's and an extension's package take.
const TEMPLATE_DIRS = { lib: 'my-lib', extension: 'my-extension' };
const CREATOR_REF = `create-crossbind@${RELEASE.companions['create-crossbind'].version}`;
const quoted = (word) => (/\s/.test(word) ? `"${word}"` : word);

// The command names its template the way create-crossbind's own usage does; the source is the tag the published
// creator was cut from, so it is what the command writes. `title` names a template outside its group's tab.
export const TEMPLATE_GROUPS = GROUP_LABELS.map(([group, label]) => ({
    id: slug(label),
    label,
    templates: TEMPLATE_MANIFEST.filter((template) => template.group === group).map((template) => {
        const name = [template.framework === label ? null : template.framework, template.label].filter(Boolean).join(' · ');
        return {
            key: template.key,
            label: name,
            title: name === label ? name : `${label} · ${name}`,
            command: `npm create crossbind${RELEASE.distTagSuffix} -- ${TEMPLATE_DIRS[template.kind] ?? 'my-app'} ${[template.group, template.framework, template.label].filter(Boolean).map(quoted).join(' ')}`,
            source: `${REPO_URL}/tree/${CREATOR_REF}/${template.source}`,
        };
    }),
})).filter((group) => group.templates.length > 0);

// The template the page opens on: the most common start.
export const DEFAULT_TEMPLATE = 'web-react-vite';

const lede = `${APP_COUNT} apps on ${LIBRARY_COUNT} open-source libraries, from GDAL and OpenSSL to SQLite, compiled to WebAssembly by crossbind. Open one with your own files, and read the C++ and JavaScript behind it.`;

export default {
    kind: 'examples',
    slug: 'examples',
    title: 'Examples',
    description: `${APP_COUNT} apps on ${LIBRARY_COUNT} open-source C and C++ libraries running in the browser, each with its code, and a start for every create-crossbind template: web, Node.js, mobile, desktop, edge, executables, libraries and app extensions.`,
    lede,
    section: 'Examples',
    path: '/examples',
    href: '/examples/',
    blocks: [
        { type: 'h2', id: 'start', text: 'Start a project' },
        {
            type: 'ul',
            items: TEMPLATE_GROUPS.flatMap((group) => group.templates.map((template) => `${template.title}: \`${template.command}\` ([source](${template.source}))`)),
        },
        // A library page's Markdown copy has no app sections, so the list links to the page itself.
        ...APP_GROUPS.flatMap((group) => [
            { type: 'h2', id: group.id, text: group.label },
            { type: 'ul', items: group.apps.map((app) => `[${app.title}](/ports/${app.family}/), with ${app.library}`) },
        ]),
    ],
};
