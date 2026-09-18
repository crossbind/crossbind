import build from '@crossbind/port-curl/build.mjs';

const easyPerformAbove = `
#ifdef __EMSCRIPTEN__
static void on_success(emscripten_fetch_t *fetch) {
    void **userData = (void **)fetch->userData;
    volatile emscripten_fetch_t **fetch_result_ptr = (volatile emscripten_fetch_t **)userData[0];
    volatile int *fetch_completed_ptr = (volatile int *)userData[1];
    *fetch_result_ptr = fetch;
    *fetch_completed_ptr = 1;
}

static void on_error(emscripten_fetch_t *fetch) {
    void **userData = (void **)fetch->userData;
    volatile emscripten_fetch_t **fetch_result_ptr = (volatile emscripten_fetch_t **)userData[0];
    volatile int *fetch_completed_ptr = (volatile int *)userData[1];
    *fetch_result_ptr = fetch;
    *fetch_completed_ptr = 1;
}
#endif
`;

const easyPerformInside = `
#ifdef __EMSCRIPTEN__
    char method[10] = "GET";
    switch (data->set.method) {
        case HTTPREQ_GET:
            strcpy(method, "GET");
            break;
        case HTTPREQ_POST:
        case HTTPREQ_POST_FORM:
        case HTTPREQ_POST_MIME:
            strcpy(method, "POST");
            break;
        case HTTPREQ_PUT:
            strcpy(method, "PUT");
            break;
        case HTTPREQ_HEAD:
            strcpy(method, "HEAD");
            break;
    }
    if (CURL_EASY_STR(data, STRING_CUSTOMREQUEST)) {
        strcpy(method, CURL_EASY_STR(data, STRING_CUSTOMREQUEST));
    }
    emscripten_fetch_attr_t attr;
    emscripten_fetch_attr_init(&attr);
    strcpy(attr.requestMethod, method);
    if (data->set.postfields) {
        attr.requestData = data->set.postfields;
        attr.requestDataSize = strlen(data->set.postfields);
    }
    if (data->set.headers) {
        int header_count = 0;
        struct curl_slist* temp = data->set.headers;
        while (temp) {
            header_count++;
            temp = temp->next;
        }

        const char** result = (const char**)malloc(sizeof(char*) * (header_count * 2 + 1));

        temp = data->set.headers;
        int i = 0;
        while (temp) {
            char* header_line = strdup(temp->data);
            char* colon = strchr(header_line, ':');

            if (colon) {
                *colon = '\0';
                char* value = colon + 1;

                while (*value == ' ') value++;

                result[i++] = strdup(header_line);
                result[i++] = strdup(value);
            } else {}

            free(header_line);
            temp = temp->next;
        }
        result[i] = NULL;

        attr.requestHeaders = result;
    }
    attr.attributes = EMSCRIPTEN_FETCH_LOAD_TO_MEMORY;

    volatile int fetch_completed = 0;
    volatile emscripten_fetch_t* fetch = NULL;
    void* userData[2] = { (void*)&fetch, (void*)&fetch_completed };

    attr.onsuccess = on_success;
    attr.onerror = on_error;
    attr.userData = userData;

    emscripten_fetch(&attr, (const char *)Curl_bufref_ptr(&data->state.url));

    while (!fetch_completed) {
        emscripten_sleep(100);
    }

    data->info.httpcode = fetch->status;
    if (fetch->status == 200) {
        if (data->set.out) {
            data->set.fwrite_func(fetch->data, 1, fetch->numBytes, data->set.out);
        }
    } else if (fetch->status >= 400) {
        if (data->set.http_fail_on_error && data->set.errorbuffer) {
            data->set.fwrite_func(fetch->data, 1, fetch->numBytes, data->set.errorbuffer);
        } else if (data->set.out) {
            data->set.fwrite_func(fetch->data, 1, fetch->numBytes, data->set.out);
        }
    } else {
        if (data->set.out) {
            data->set.fwrite_func(fetch->data, 1, fetch->numBytes, data->set.out);
        }
    }

    if (attr.requestHeaders) {
        for (int i = 0; attr.requestHeaders[i] != NULL; i++) {
            free((void*)attr.requestHeaders[i]);
        }

        free(attr.requestHeaders);
    }

    emscripten_fetch_close(fetch);

    if (data->set.http_fail_on_error && fetch->status >= 400) {
        return CURLE_HTTP_RETURNED_ERROR;
    }

    return CURLE_OK;
#endif
`;

const fetchImportString = `
#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#include <emscripten/fetch.h>
#endif
`;

export default {
    ...build,
    replaceList: [
        {
            regex: 'static CURLcode easy_perform\\(struct Curl_easy \\*data, bool events\\)',
            replacement: `${easyPerformAbove}\nstatic CURLcode easy_perform(struct Curl_easy *data, bool events)`,
            paths: ['lib/easy.c'],
        },
        {
            regex: '  struct Curl\\_multi \\*multi\\;',
            replacement: `${easyPerformInside}\n  struct Curl_multi *multi;`,
            paths: ['lib/easy.c'],
        },
        {
            regex: '#include "urldata.h"',
            replacement: `${fetchImportString}\n#include "urldata.h"`,
            paths: ['lib/easy.c'],
        },
    ],
};
