import snapshot from '../generated/release-snapshot.js';

// The one verified release snapshot the whole site is built from: the navbar badge, the changelog
// page and the Quick Start commands all read it, so they cannot disagree. It is generated before
// every dev/build run by `pnpm run resolve:release` (see package.json and README.md); a missing
// module here means that step did not run.
export const RELEASE = snapshot;

// The toolchain image the CLI pulls, from the digest table at the release commit rather than a
// hand-maintained tag that goes stale.
export const WEB_IMAGE = `${RELEASE.toolchainDigestTable.registry}/web:${RELEASE.toolchainDigestTable.version}`;
