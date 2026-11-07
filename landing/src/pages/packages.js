import catalog from '../../generated/packages-catalog.js';
import { formatPublishedAt } from '../changelog/format.js';
import { CHANGELOG_PAGE } from '../changelog/page.js';
import { changelogHref } from '../changelog/route.js';
import { PACKAGES_URL, REPO_URL } from '../data.js';
import { PORTS } from '../ports/catalog.js';
import { RELEASE } from '../release.js';

// /packages/: every package the release train publishes, by what it is, with the version npm serves on the site's
// dist-tag (scripts/site/build-packages-catalog.mjs), a library's packages folded under its name. Each published package
// has a page of its releases at /packages/<name>/, and each library one for all of its packages. PackagesPage.jsx and
// PackagePage.jsx lay them out; the blocks below are what search and llms.txt read.

export const NOT_PUBLISHED = 'Not published yet';

// The folders each group's packages come from, in the order its rows take; one ending in a star takes those under it.
const GROUPS = [
    { id: 'cli', label: 'CLI', folders: ['core/crossbind', 'tooling/create-app', 'tooling/bridge-tools'] },
    { id: 'plugins', label: 'Plugins', folders: ['plugins/*'] },
    { id: 'libraries', label: 'Libraries', folders: ['ports/*'] },
    { id: 'apps', label: 'Apps', folders: ['core/app-host', 'core/store-kit'] },
    { id: 'extensions', label: 'Extensions', folders: ['extensions/*'] },
    { id: 'bindings', label: 'Bindings', folders: ['core/embind-*'] },
    { id: 'examples', label: 'Examples and tooling', folders: ['examples/*', 'tooling/typescript-config'] },
];

const holds = (folder, path) => (folder.endsWith('*') ? path.startsWith(folder.slice(0, -1)) : path === folder);
const folderOf = (group, path) => group.folders.findIndex((folder) => holds(folder, path));

export const groupOf = (path) => GROUPS.find((group) => folderOf(group, path) !== -1)?.id ?? null;

const homeless = catalog.packages.filter((item) => !groupOf(item.path));
if (homeless.length) throw new Error(`/packages/ has no group for ${homeless.map(({ path }) => path).join(', ')}; add its folder to GROUPS.`);

const slugOf = (name) => name.replace(/^@crossbind\//, '');
const pageHref = (slug) => `${PACKAGES_URL}${slug}/`;
const npmOf = ({ name, version }) => `https://www.npmjs.com/package/${name}/v/${version}`;
const githubOf = ({ name, version }, folder) => `${REPO_URL}/tree/${name}@${version}/${folder}`;

// A published package's row opens its page, with npm's page of its version and its folder at its tag beside it.
const rowOf = (item, href) =>
    item.version
        ? { name: item.name, version: item.version, href, npm: npmOf(item), github: githubOf(item, item.path) }
        : { name: item.name, version: null, href: null, npm: null, github: null };

const coreOf = (version) => version.split('-')[0];
const prereleaseOf = (version) => version.slice(coreOf(version).length + 1);
const numeric = (left, right) => left.localeCompare(right, 'en', { numeric: true });

// Oldest first, a release after its own prereleases: 2.0.0-beta.9, 2.0.0-beta.10, 2.0.0-rc.1, 2.0.0.
const byVersion = (left, right) =>
    numeric(coreOf(left), coreOf(right)) ||
    Number(!prereleaseOf(left)) - Number(!prereleaseOf(right)) ||
    numeric(prereleaseOf(left), prereleaseOf(right));

// The version a library's packages are on, or the oldest and the newest of theirs, a prerelease they share written once,
// as 2.0.0-beta.67–68.
export function versionSpan(versions) {
    const published = [...new Set(versions.filter(Boolean))].sort(byVersion);
    if (published.length < 2) return published[0] ?? null;
    const [oldest, newest] = [published[0], published.at(-1)];
    const shared = oldest.slice(0, oldest.lastIndexOf('.') + 1);
    const isSharedPrerelease = shared.includes('-') && newest.startsWith(shared) && /^\d+$/.test(newest.slice(shared.length));
    return isSharedPrerelease ? `${oldest}–${newest.slice(shared.length)}` : `${oldest} – ${newest}`;
}

// How many packages a library's row folds, and how many of them npm does not serve yet where only some are missing.
export function packagesLabel({ packages }) {
    const missing = packages.filter(({ version }) => !version).length;
    return missing && missing < packages.length ? `${packages.length} packages, ${missing} not published yet` : `${packages.length} packages`;
}

const familyOf = (item) => item.path.split('/')[1];
const librarySlug = (family) => `port-${family}`;

function familiesOf(items) {
    return [...new Set(items.map(familyOf))]
        .map((family) => ({
            family,
            name: PORTS.find((port) => port.family === family)?.name ?? family,
            items: items.filter((item) => familyOf(item) === family),
        }))
        .sort((left, right) => left.name.localeCompare(right.name, 'en'));
}

const packageRows = ({ family, items }) => items.map((item) => rowOf(item, pageHref(librarySlug(family))));

const groupItems = (group) =>
    catalog.packages
        .filter((item) => groupOf(item.path) === group.id)
        .sort((left, right) => folderOf(group, left.path) - folderOf(group, right.path) || left.name.localeCompare(right.name, 'en'));

export const PACKAGE_GROUPS = GROUPS.map((group) =>
    group.id === 'libraries'
        ? {
              id: group.id,
              label: group.label,
              families: familiesOf(groupItems(group)).map((library) => {
                  const packages = packageRows(library);
                  return { id: library.family, name: library.name, packages, version: versionSpan(packages.map(({ version }) => version)) };
              }),
          }
        : { id: group.id, label: group.label, items: groupItems(group).map((item) => rowOf(item, pageHref(slugOf(item.name)))) },
);

const TYPED = /^\w+(\([^)]*\))?(!)?:\s*/;

// A commit subject as a line of a release: its type and scope left out, the rest as written, so macOS stays macOS, and a
// breaking change said to be one.
export function changeText(subject) {
    const typed = subject.match(TYPED);
    const text = typed ? subject.slice(typed[0].length) : subject;
    return typed?.[2] ? `**Breaking:** ${text}` : text;
}

const publishedOn = new Map(RELEASE.history.map(({ version, publishedAt }) => [version, publishedAt]));
const noted = new Set(CHANGELOG_PAGE.blocks.filter(({ type }) => type === 'h2').map(({ id }) => id));

// A release's day, as the changelog gives it where it verified the release, the packages a library's release moved, and
// the notes of the train it came with; then what changed in the folder, which the first release has nothing before to say.
function releaseBlocks(history, { isLibrary }) {
    return history.flatMap((release) => {
        const moved = !isLibrary ? null : release.packages.length === 1 ? `\`${release.packages[0]}\`` : `${release.packages.length} packages`;
        const notes = noted.has(release.version) ? `[Release notes](${changelogHref(release.version)})` : null;
        const line = [formatPublishedAt(publishedOn.get(release.version) ?? release.date), moved, notes].filter(Boolean).join(' · ');
        const changes = !release.changes
            ? []
            : release.changes.length
              ? [
                    {
                        type: 'ul',
                        items: release.changes.map(
                            ({ commit, subject }) => `${changeText(subject)} [${commit.slice(0, 7)}](${REPO_URL}/commit/${commit})`,
                        ),
                    },
                ]
              : [{ type: 'p', text: 'No change of its own: released again with the train.' }];
        return [{ type: 'h2', id: release.version, text: release.version }, { type: 'p', text: line }, ...changes];
    });
}

function packagePage({ slug, title, description, version, links, history, isLibrary = false }) {
    return {
        kind: 'package',
        slug,
        title: `Releases of ${title}`,
        description,
        lede: '',
        section: 'Packages',
        // A version's heading on every package's page would bury the changelog's own in search.
        shouldIndexSections: false,
        path: `/packages/${slug}`,
        href: pageHref(slug),
        version,
        links,
        blocks: releaseBlocks(history, { isLibrary }),
    };
}

const ownPages = catalog.packages
    .filter((item) => item.version && groupOf(item.path) !== 'libraries')
    .map((item) =>
        packagePage({
            slug: slugOf(item.name),
            title: item.name,
            description: `Every release of ${item.name} and what changed in it.`,
            version: item.version,
            links: [
                { label: 'npm', href: npmOf(item) },
                { label: 'GitHub', href: githubOf(item, item.path) },
            ],
            history: catalog.histories[item.history],
        }),
    );

const libraryPages = familiesOf(catalog.packages.filter((item) => groupOf(item.path) === 'libraries'))
    .filter(({ items }) => items.some(({ version }) => version))
    .map((library) => {
        const shown = library.items.find(({ path, version }) => version && path.endsWith('/base')) ?? library.items.find(({ version }) => version);
        return packagePage({
            slug: librarySlug(library.family),
            title: library.name,
            description: `Every release of the ${library.items.length} ${library.name} packages and what changed in them.`,
            version: versionSpan(library.items.map(({ version }) => version)),
            links: [
                { label: 'npm', href: npmOf(shown) },
                { label: 'GitHub', href: githubOf(shown, `ports/${library.family}`) },
            ],
            history: catalog.histories[shown.history],
            isLibrary: true,
        });
    });

export const PACKAGE_PAGES = [...ownPages, ...libraryPages];

const rowsOf = (group) => group.families?.flatMap((family) => family.packages) ?? group.items;
const line = ({ name, version, npm }) => (npm ? `[${name}](${npm}): ${version}` : `${name}: not published yet`);

export default {
    kind: 'packages',
    slug: 'packages',
    title: 'Packages',
    description: `Every package crossbind publishes on npm, by what it is, with the version its ${catalog.distTag} tag installs.`,
    lede: `Every package crossbind publishes on npm, with the version its \`${catalog.distTag}\` tag installs.`,
    section: 'Packages',
    path: '/packages',
    href: PACKAGES_URL,
    blocks: PACKAGE_GROUPS.flatMap((group) => [
        { type: 'h2', id: group.id, text: group.label },
        { type: 'ul', items: rowsOf(group).map(line) },
    ]),
};
