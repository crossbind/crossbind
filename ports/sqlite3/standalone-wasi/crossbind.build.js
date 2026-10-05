import base from '@crossbind/port-sqlite3/build.mjs';

export default {
    ...base,
    // Bin package: keep the shell - drop the family gate pin and avoid --with-wasi-sdk
    // (that mode force-disables the CLI); the generic cross setup builds it instead.
    sourceReplaceList: () => [],
    getBuildParams: (target) => (target.platform === 'wasi'
        ? ['--disable-shared', '--host=x86_64-pc-linux-gnu']
        : base.getBuildParams(target)),
    // The shell needs signal/getpid/clock beyond the core: link the wasi emulation libs.
    getExtraLibs: (target) => (target.platform === 'wasi'
        ? ['-lwasi-emulated-signal', '-lwasi-emulated-getpid', '-lwasi-emulated-process-clocks']
        : (base.getExtraLibs ? base.getExtraLibs(target) : [])),
    bin: { tools: { sqlite3: { kind: 'binary', publish: true } } },
};
