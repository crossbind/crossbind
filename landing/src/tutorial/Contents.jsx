import { Fragment } from 'react';
import { SideHeading, SideLink } from '../components/side.jsx';
import { contentsColumns } from './sections.js';

// The tutorial's contents: every step under its section, numbered, so a reader sees all there is and jumps to any of
// it. TutorialPage.jsx puts the list beside the lesson on a wide screen and inside the step menu on a narrower one,
// there in `columns` of about the same height. Its rows sit closer than the guide's, so the whole course shows at
// once.

const HEADING = { margin: '10px 0 3px' };
const FIRST_HEADING = { margin: '0 0 3px' };
const LINK = { padding: '2px 0 2px 10px' };
const CURRENT = { ...LINK, fontWeight: 600 };

function Sections({ tokens, sections, path }) {
    return sections.map((section, index) => (
        <Fragment key={section.label}>
            <SideHeading tokens={tokens} number={section.number} style={index === 0 ? FIRST_HEADING : HEADING}>{section.label}</SideHeading>
            {section.pages.map((page) => (
                <SideLink key={page.path} tokens={tokens} href={page.href} label={page.title} number={page.number} active={page.path === path} style={page.path === path ? CURRENT : LINK} />
            ))}
        </Fragment>
    ));
}

export default function Contents({
    tokens, sections, path, columns = 1,
}) {
    if (columns === 1) return <Sections tokens={tokens} sections={sections} path={path} />;
    const filled = contentsColumns(sections, columns).filter((column) => column.length > 0);
    return (
        <div className="tutorial-contents" style={{ '--columns': filled.length }}>
            {filled.map((column) => (
                <div key={column[0].label} style={{ display: 'flex', flexDirection: 'column' }}>
                    <Sections tokens={tokens} sections={column} path={path} />
                </div>
            ))}
        </div>
    );
}
