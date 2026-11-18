// The tutorial's contents as its panel and its menu list them (Contents.jsx): the steps in reading order, grouped
// into the parts they name, each numbered by its section and its place in it. Plain data in, plain data out.

const rowsOf = (section) => section.pages.length + 1;

// Consecutive steps of one part make a section.
export const tutorialSections = (pages) => pages
    .reduce((sections, page) => {
        const last = sections.at(-1);
        return last?.label === page.part
            ? [...sections.slice(0, -1), { ...last, pages: [...last.pages, page] }]
            : [...sections, { label: page.part, pages: [page] }];
    }, [])
    .map((section, index) => ({
        number: `${index + 1}`,
        label: section.label,
        pages: section.pages.map((page, at) => ({
            number: `${index + 1}.${at + 1}`, title: page.title, href: page.href, path: page.path,
        })),
    }));

// Where the step at `path` sits: its section, its place in it and how many steps the section has.
export function positionOf(sections, path) {
    const section = sections.find((candidate) => candidate.pages.some((page) => page.path === path));
    if (!section) return null;
    return { section: section.label, step: section.pages.findIndex((page) => page.path === path) + 1, steps: section.pages.length };
}

// The sections in `count` columns of about the same height, in reading order: a section goes to the column its
// middle row falls in, and to the earlier one when that row is the last of a column.
export function contentsColumns(sections, count) {
    const perColumn = sections.reduce((total, section) => total + rowsOf(section), 0) / count;
    const placed = sections.reduce(({ before, columns }, section) => {
        const at = Math.min(count - 1, Math.ceil((before + rowsOf(section) / 2) / perColumn) - 1);
        return { before: before + rowsOf(section), columns: columns.map((column, index) => (index === at ? [...column, section] : column)) };
    }, { before: 0, columns: Array.from({ length: count }, () => []) });
    return placed.columns;
}
