import assert from 'node:assert/strict';
import test from 'node:test';

import { runEnvironment } from '../../scripts/skill-eval/environment.mjs';

const SHELL = Object.freeze({
    PATH: '/usr/bin',
    HOME: '/home/someone',
    CLAUDE_CODE_EFFORT_LEVEL: 'max',
    CLAUDE_EFFORT: 'max',
    CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING: '1',
    MAX_THINKING_TOKENS: '32000',
});

test("without an effort the runs take Claude Code's default, whatever the shell exports", () => {
    assert.deepEqual(runEnvironment(SHELL), { PATH: '/usr/bin', HOME: '/home/someone' });
});

test("an effort reaches the runs, and the shell's thinking settings do not", () => {
    assert.deepEqual(runEnvironment(SHELL, 'low'), { PATH: '/usr/bin', HOME: '/home/someone', CLAUDE_CODE_EFFORT_LEVEL: 'low' });
});
