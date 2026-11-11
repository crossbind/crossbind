#include "feel.h"

#include <webkit2/webkit2.h>

namespace crossbind::pagefeel {

void configure(void *webView) {
    WebKitUserScript *script = webkit_user_script_new(PAGE_SCRIPT, WEBKIT_USER_CONTENT_INJECT_TOP_FRAME, WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START, nullptr, nullptr);
    webkit_user_content_manager_add_script(webkit_web_view_get_user_content_manager(WEBKIT_WEB_VIEW(webView)), script);
    webkit_user_script_unref(script);
}

}  // namespace crossbind::pagefeel
