import build from '@crossbind/port-curl/build.mjs';

const EMSCRIPTEN = (code) => `#ifdef __EMSCRIPTEN__\n${code}#endif\n`;
// A line of lib/multi.c's public calls that crossbind_fetch_multi.c answers instead in this build.
const multiCall = (line, call) => ({
    regex: line,
    replacement: `#ifdef __EMSCRIPTEN__\n${call}#else\n$&#endif\n`,
    paths: ['lib/multi.c'],
});

// easy_perform hands every transfer to assets/crossbind_fetch.c, copied next to lib/easy.c: curl's own engine has no
// sockets in this build. The multi interface's calls go to assets/crossbind_fetch_multi.c, which runs the transfers
// a multi handle is given through easy_perform, one after another.
export default {
    ...build,
    copyToSource: {
        'assets/crossbind_fetch.c': 'lib/crossbind_fetch.c',
        'assets/crossbind_fetch_request.c': 'lib/crossbind_fetch_request.c',
        'assets/crossbind_fetch_multi.c': 'lib/crossbind_fetch_multi.c',
    },
    replaceList: [
        {
            regex: 'struct Curl_multi \\{\\n',
            replacement: `$&${EMSCRIPTEN('  struct crossbind_multi_xfer *crossbind_xfers; /* crossbind_fetch_multi.c */\n')}`,
            paths: ['lib/multihandle.h'],
        },
        {
            regex: 'CURLMcode curl_multi_add_handle\\(CURLM \\*m, CURL \\*curl\\)\\n\\{',
            replacement: `${EMSCRIPTEN('#include "crossbind_fetch_multi.c"\n')}\n$&`,
            paths: ['lib/multi.c'],
        },
        multiCall('      mresult = Curl_multi_add_handle\\(m, data\\);\\n', '      mresult = crossbind_multi_add(m, data);\n'),
        multiCall('      mresult = Curl_multi_remove_handle\\(m, data\\);\\n', '      mresult = crossbind_multi_remove(m, data);\n'),
        multiCall('    mresult = multi_perform\\(m, running_handles\\);\\n', '    mresult = crossbind_multi_perform(m, running_handles);\n'),
        multiCall(
            '    mresult = multi_wait\\(m, extra_fds, extra_nfds, timeout_ms, ret, (?:FALSE|TRUE)\\);\\n',
            '    mresult = crossbind_multi_wait(ret);\n',
        ),
        {
            regex: '    if\\(Curl_uint32_bset_first\\(&multi->msgsent, &mid\\)\\) \\{\\n      struct Curl_easy \\*data = Curl_multi_get_easy\\(multi, mid\\);\\n',
            replacement: `${EMSCRIPTEN('    msg_result = crossbind_multi_info_read(multi, msgs_in_queue);\n    if(!msg_result)\n')}$&`,
            paths: ['lib/multi.c'],
        },
        {
            regex: '  if\\(CURL_MAPI_ENTER\\(&guard, m, multi_cleanup, &mresult\\)\\) \\{\\n    struct Curl_multi \\*multi = m;\\n    void \\*entry;\\n    uint32_t mid;\\n',
            replacement: `$&${EMSCRIPTEN('    crossbind_multi_forget(multi);\n')}`,
            paths: ['lib/multi.c'],
        },
        {
            regex: 'static CURLcode easy_perform\\(struct Curl_easy \\*data, bool events\\)\\n\\{',
            replacement: '#ifdef __EMSCRIPTEN__\n#include "crossbind_fetch.c"\n#endif\n\n$&',
            paths: ['lib/easy.c'],
        },
        {
            regex: '  if\\(data->multi\\) \\{\\n    failf\\(data, "easy handle already used in multi handle"\\);\\n    return CURLE_FAILED_INIT;\\n  \\}\\n',
            replacement: '$&#ifdef __EMSCRIPTEN__\n  return crossbind_fetch_perform(data);\n#endif\n',
            paths: ['lib/easy.c'],
        },
    ],
};
