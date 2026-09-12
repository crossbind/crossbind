import manifest from '../generated/example-demos.js';

// Live demos built by scripts/site/build-example-demos.mjs and hosted under /examples/<id>/.
// Absent in CI and offline builds; the Examples page only embeds what was built.
export const DEMOS = new Map(manifest.demos.map((demo) => [demo.id, demo]));
export const DEMOS_BUILT_AT = manifest.builtAt;
