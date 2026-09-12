// The npm channel the site is built from. This is the one value to change when crossbind moves
// on: 'beta' resolves the npm `beta` tag, 'rc' resolves `next`, 'stable' resolves `latest`.
// The build resolves it to one exact `crossbind` version (scripts/release/resolve-site-release.mjs)
// and never falls back to another channel, so a stale `latest` on npm cannot leak into a beta site.
export default { channel: 'beta' };
