import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const { dependencyStatus, parseRange } = createRequire(import.meta.url)('../../check-external-dependencies.js');
const usage = (field, spec) => ({ field, spec, parsed: parseRange(spec) });

// Seen on 2026-09-23: prettier read up to date while the lockfile carried both 3.9.6 and 3.9.8.
test('a dependency one manifest still holds below npm is outdated however many are current', () => {
    const usages = [usage('devDependencies', '^3.9.8'), usage('devDependencies', '^3.9.6')];

    assert.deepEqual(dependencyStatus(usages, '3.9.8', null), { status: 'outdated', lowestInUse: '3.9.6' });
});

test('a dependency every manifest holds at npm is up to date', () => {
    const usages = [usage('devDependencies', '^3.9.8'), usage('dependencies', '3.9.8')];

    assert.deepEqual(dependencyStatus(usages, '3.9.8', null), { status: 'up-to-date', lowestInUse: '3.9.8' });
});

test('a peer floor below npm leaves a dependency up to date', () => {
    const usages = [usage('peerDependencies', '>=1.0.0'), usage('devDependencies', '^2.4.0')];

    assert.deepEqual(dependencyStatus(usages, '2.4.0', null), { status: 'up-to-date', lowestInUse: '2.4.0' });
});

test('a dependency whose every range leaves the version to the host app is host-provided', () => {
    const usages = [usage('peerDependencies', '*'), usage('peerDependencies', '>=0.70.0')];

    assert.equal(dependencyStatus(usages, '0.80.0', null).status, 'host-provided');
});
