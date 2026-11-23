// The environment the eval command and its runs start in.

// Claude Code takes its effort and thinking from these, so a shell that exports them would set the runs' own.
const INHERITED = ['CLAUDE_CODE_EFFORT_LEVEL', 'CLAUDE_EFFORT', 'CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING', 'MAX_THINKING_TOKENS'];

export function runEnvironment(environment, effort) {
    const kept = Object.fromEntries(Object.entries(environment).filter(([name]) => !INHERITED.includes(name)));
    return effort ? { ...kept, CLAUDE_CODE_EFFORT_LEVEL: effort } : kept;
}
