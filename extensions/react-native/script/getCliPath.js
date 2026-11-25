import { createRequire } from 'node:module';
import path from 'node:path';

// CMake parses this script's stdout as a single path, so it must not pull in the full
// crossbind state (loadConfig can log to stdout). Resolve the CLI root purely from the
// package location: paths.cli is always `<crossbind package>/src`.
const require = createRequire(import.meta.url);
const packageJsonPath = require.resolve('crossbind/package.json');

console.log(path.join(path.dirname(packageJsonPath), 'src'));
