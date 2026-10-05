import base from '@crossbind/port-openssl/build.mjs';

export default {
    ...base,
    // openssl's `make -j install` builds the apps objects from two goals at once; split the phases.
    makePhases: [['all'], ['install']],
    // Apps on: drop no-apps; add no-sock (s_client/s_server need a socket surface wasi lacks).
    getBuildParams: (target) => [
        ...base.getBuildParams(target).filter((p) => p !== 'no-apps'),
        'no-sock',
        'no-secure-memory',
        '-DHAVE_FORK=0',
        '-lwasi-emulated-signal', '-lwasi-emulated-mman', '-lwasi-emulated-getpid', '-lwasi-emulated-process-clocks',
    ],
    // wasi-libc has no syslog.h; stub the tiny API the apps' logger uses.
    replaceList: [
        ...(base.replaceList || []),
        {
            regex: ' speed\\.c',
            replacement: '',
            paths: ['apps/build.info'],
        },
        {
            regex: '# *include <syslog\\.h>',
            replacement: '#define LOG_EMERG 0\n#define LOG_ALERT 1\n#define LOG_CRIT 2\n#define LOG_ERR 3\n#define LOG_WARNING 4\n#define LOG_NOTICE 5\n#define LOG_INFO 6\n#define LOG_DEBUG 7\n#define LOG_USER 8\n#define LOG_PID 1\n#define LOG_CONS 2\nstatic __attribute__((unused)) void openlog(const char*a,int b,int c){(void)a;(void)b;(void)c;}\nstatic __attribute__((unused)) void closelog(void){}\nstatic __attribute__((unused)) void syslog(int p,const char*f,...){(void)p;(void)f;}',
            paths: ['apps/include/log.h'],
        },
    ],
    bin: { tools: { openssl: { kind: 'binary', publish: true } } },
};
