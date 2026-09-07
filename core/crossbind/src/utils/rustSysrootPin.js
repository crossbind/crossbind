// The published sysroot image a host build (RUNNER=LOCAL) reads its Rust sysroots out of - the same
// object the web image embeds, not a repackaged copy, so the two channels cannot drift. The index
// digest is the whole contract: the loader verifies the index body against it, then each descriptor
// inside a verified body authenticates the next fetch, down to the layer.
import { createRequire } from 'node:module';

const table = createRequire(import.meta.url)('../assets/toolchain-digests.json');
const sysroot = table.images['rust-sysroot'];

export default {
    version: table.version,
    image: `${table.registry}/rust-sysroot`,
    index: sysroot.index,
};
