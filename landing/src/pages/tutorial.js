import { tutorialSections } from '../../../tooling/learn/src/sections.js';
import { tutorialSteps } from '../../../tooling/learn/src/tutorial.js';
import {
    CREATE_COMMAND, LIBRARIES_URL, PLAYGROUND_URL, TUTORIAL_URL,
} from '../data.js';
import { guideHref } from '../guide/nav.js';

// /tutorial/: one page per lesson of @crossbind/learn's tutorial (tooling/learn/src/tutorial.js), each runnable in the
// page and linking the site's own pages. TutorialPage.jsx is the interactive part; these blocks are what search and
// llms.txt see. Plain data, so Node can import it like every page.

const lesson = (sample) => `${TUTORIAL_URL}${sample}/`;
const STEPS = tutorialSteps({
    lesson, guide: guideHref, libraries: LIBRARIES_URL, playground: PLAYGROUND_URL, createCommand: CREATE_COMMAND,
});

// The first lesson is the tutorial's own address; the others sit under it by sample. A lesson's heading is its topic
// alone, while the browser tab, search and llms.txt also say it is part of the tutorial.
export const TUTORIAL_PAGES = STEPS.map((step, index) => {
    const href = index === 0 ? TUTORIAL_URL : lesson(step.sample);
    return {
        kind: 'tutorial',
        section: 'Tutorial',
        path: href.replace(/\/$/, ''),
        href,
        ...step,
        headTitle: `Tutorial: ${step.title}`,
        description: `${step.description} Lesson ${index + 1} of the crossbind tutorial.`,
    };
});

// The contents: every lesson under its part, numbered (tooling/learn/src/sections.js).
export const TUTORIAL_SECTIONS = tutorialSections(TUTORIAL_PAGES);
