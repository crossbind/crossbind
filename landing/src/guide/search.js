import { SITE_PAGES } from '../site-pages.js';

// Search index over every page of the site - guide, reference, Libraries and changelog. The copy
// is already data in this bundle, so the index is derived from it at load: no crawler, no extra
// build step, no index to download. gdal3.js reaches for pagefind
// because its pages are hand-written HTML; here the pages are objects.

const MAX_RESULTS = 8;

function blockText(block) {
    switch (block.type) {
        case 'p':
        case 'h2':
        case 'h3':
            return block.text;
        case 'ul':
        case 'ol':
            return block.items.join(' ');
        case 'callout':
            return `${block.title || ''} ${block.text}`;
        case 'table':
            return [...block.head, ...block.rows.flat()].join(' ');
        // Code is skipped: matching on snippets buries the prose that explains them. Cards are
        // skipped too - they repeat other pages' titles, so indexing them makes the hub match
        // every term in the guide and outrank the page that actually answers the question.
        default:
            return '';
    }
}

// One entry per page plus one per h2, so a hit lands on the section that answers the question.
function pageEntries(page) {
    const sections = [];
    let current = null;

    page.blocks.forEach((block) => {
        if (block.type === 'h2' && block.id) {
            current = {
                title: block.text, href: `${page.href}#${block.id}`, sub: page.title, body: [],
            };
            sections.push(current);
            return;
        }
        const text = blockText(block);
        if (text && current) current.body.push(text);
    });

    return [
        {
            title: page.title,
            sub: page.description,
            href: page.href,
            body: [page.lede, page.description, ...page.blocks.map(blockText)].join(' '),
        },
        ...sections.map((section) => ({
            title: section.title,
            sub: section.sub,
            href: section.href,
            body: section.body.join(' '),
        })),
    ];
}

const INDEX = SITE_PAGES.flatMap(pageEntries).map((entry) => ({
    ...entry,
    haystack: `${entry.title} ${entry.sub} ${entry.body}`.toLowerCase(),
    lowerTitle: entry.title.toLowerCase(),
    lowerSub: entry.sub.toLowerCase(),
}));

// Capped, because past a handful the count says "this page is about it" and nothing more.
const MAX_FREQUENCY_BONUS = 5;

function countOccurrences(haystack, term) {
    let count = 0;
    let at = haystack.indexOf(term);
    while (at !== -1 && count < MAX_FREQUENCY_BONUS) {
        count += 1;
        at = haystack.indexOf(term, at + term.length);
    }
    return count;
}

function scoreEntry(entry, terms) {
    let score = 0;
    for (const term of terms) {
        if (!entry.haystack.includes(term)) return 0;
        if (entry.lowerTitle.startsWith(term)) score += 100;
        else if (entry.lowerTitle.includes(term)) score += 60;
        else if (entry.lowerSub.includes(term)) score += 25;
        // Frequency separates the page that is about a term from one that mentions it in passing.
        score += countOccurrences(entry.haystack, term);
    }
    return score;
}

export function searchGuide(query) {
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];

    return INDEX
        .map((entry) => ({ entry, score: scoreEntry(entry, terms) }))
        .filter((hit) => hit.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_RESULTS)
        .map((hit) => hit.entry);
}
