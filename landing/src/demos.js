import manifest from '../generated/example-demos.js';

// Live demos built by scripts/site/build-example-demos.mjs and hosted under /examples/<id>/.
// Absent in CI and offline builds; a page shows only what was built.
export const DEMOS = new Map(manifest.demos.map((demo) => [demo.id, demo]));
export const DEMOS_BUILT_AT = manifest.builtAt;

// The demo build compiles every playground sample ahead of time as `sample-<id>`, so an unedited one runs without a
// compile. A site built without its demos has none; its samples then compile like any other code.
export const samplePrebuilt = (sampleId) => DEMOS.get(`sample-${sampleId}`);
