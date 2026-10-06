#!/usr/bin/env node
// Android takes hermesc from the hermes-compiler an app declares, and a compiler on another bytecode version than
// the Hermes VM react-native ships crashes the app at launch ("Wrong bytecode version"). Each React Native sample in
// the workspace declares the version its react-native depends on.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLES = ['examples/mobile-reactnative-cli', 'e2e/mobile-reactnative-cli'];

const mismatches = SAMPLES.flatMap((sample) => {
    const require = createRequire(path.join(ROOT, sample, 'package.json'));
    const declared = require('./package.json').dependencies['hermes-compiler'];
    const wanted = require('react-native/package.json').dependencies['hermes-compiler'];
    return declared === wanted ? [] : [`${sample}: hermes-compiler is ${declared}, react-native depends on ${wanted}`];
});

mismatches.forEach((line) => console.error(line));
process.exit(mismatches.length ? 1 : 0);
