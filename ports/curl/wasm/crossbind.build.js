import build from '@crossbind/port-curl/build.mjs';

// easy_perform hands every transfer to assets/crossbind_fetch.c, copied next to lib/easy.c:
// curl's own engine cannot create its multi handle in this build.
export default {
    ...build,
    copyToSource: {
        'assets/crossbind_fetch.c': 'lib/crossbind_fetch.c',
        'assets/crossbind_fetch_request.c': 'lib/crossbind_fetch_request.c',
    },
    replaceList: [
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
