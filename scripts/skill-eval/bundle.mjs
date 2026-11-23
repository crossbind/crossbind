// What `claude plugin eval` reads of a case: its prompt, its graders and the script that puts its project in place.

export const SKILL_NAME = 'crossbind';
// A run reads, searches, loads skills and runs the skill's own read-only inspector, and nothing else.
export const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep', 'Skill', 'Bash'];
export const INSPECTOR_GRANT = 'Bash(node *inspect-project.mjs*)';

// Reaching either limit fails the run. The longest first runs took 42 turns and 622 s; a brief or a slower model takes more.
const MAX_TURNS = 120;
const TIMEOUT_SECONDS = 1800;
// Said to every run alike, with and without the skill, so that an answer is a plan a grader can read.
const READ_ONLY_NOTE = 'This session is read-only: you can read files, search, load skills and run read-only inspection scripts, '
    + 'but you cannot edit files or run builds. Do not ask the user questions; state the assumptions you make. '
    + 'Answer with what you would do: the files you would change and what goes in them, the commands you would run, '
    + 'and what you could not check here.';

const frontmatter = (fields) => `---\n${Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join('\n')}\n---\n`;
const shellQuote = (text) => `'${text.replaceAll("'", "'\\''")}'`;

// Passes on a final message that says anything at all, so that every case has a grader.
const ANSWERED = frontmatter({ type: 'regex', pattern: "'\\S'" });

function triggerGrader(trigger) {
    if (trigger === 'either') return null;
    return frontmatter({
        type: 'tool_used',
        tool: 'Skill',
        input_match: `'"skill"\\s*:\\s*"(?:[\\w-]+:)?${SKILL_NAME}"'`,
        ...(trigger === 'must-not' ? { min: 0, max: 0 } : {}),
    });
}

function routeGrader(route) {
    const paths = route.map((reference) => reference.replaceAll('.', '\\.')).join('|');
    return frontmatter({ type: 'tool_used', tool: 'Read', input_match: `'(?:${paths})'` });
}

function factGrader(claim) {
    return [
        frontmatter({ type: 'llm' }),
        'The assistant worked in a read-only session, so its final answer is a plan.',
        `PASS if the answer does this, or tells the user to do it: ${claim}.`,
        'FAIL if it leaves this out, does something else in its place, or advises against it.',
        'That nothing was run or changed is no reason to fail.',
        'Judge this one point alone, and ignore the rest of the answer.',
        '',
    ].join('\n');
}

// The files of one case's folder, by their paths in it. `fixtureDirectory` is where the case's project waits to be
// copied from; a case without one starts in an empty folder.
export function caseFiles(entry, fixtureDirectory = null) {
    const files = {
        'prompt.md': `${frontmatter({
            name: entry.id,
            tags: `[${[entry.tags[0], entry.trigger, entry.split].join(', ')}]`,
            max_turns: MAX_TURNS,
            timeout_seconds: TIMEOUT_SECONDS,
            allowed_tools: `[${READ_ONLY_TOOLS.join(', ')}]`,
            append_system_prompt: JSON.stringify(READ_ONLY_NOTE),
        })}\n${entry.prompt}\n`,
        'graders/answered.md': ANSWERED,
    };
    const trigger = triggerGrader(entry.trigger);
    if (trigger) files['graders/trigger.md'] = trigger;
    if (entry.route?.length) files['graders/route.md'] = routeGrader(entry.route);
    (entry.facts ?? []).forEach((fact, index) => {
        files[`graders/fact-${index + 1}.md`] = factGrader(fact.claim);
    });
    if (fixtureDirectory) {
        files['case.yaml'] = `schema_version: "1.1"\nname: ${entry.id}\ncontext:\n  scaffold_script: fixture.sh\n`;
        files['fixture.sh'] = `#!/bin/bash\nset -euo pipefail\ncp -R ${shellQuote(fixtureDirectory)}/. .\n`;
    }
    return files;
}

// The manifest lives in the bundle alone: the repository ships the skill with no plugin around it.
export function pluginManifest(version) {
    return { name: SKILL_NAME, version, description: 'The crossbind skill, wrapped as a plugin for one evaluation run.' };
}
