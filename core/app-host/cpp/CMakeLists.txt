cmake_minimum_required(VERSION 3.28)
if(APPLE)
    project(crossbind_app CXX OBJCXX)
else()
    project(crossbind_app CXX)
endif()

# crossbind configures this project for one app host: the window and its webview, Hermes and the embind runtime
# compile here, the project's own code arrives as prebuilt archives in CROSSBIND_LINK_ARGS. An iOS host is a static
# library instead, which the app's Xcode project links with those archives, and an Android host a shared library the
# app's activity loads, beside the JSI its Hermes loads.

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(THIRD_PARTY "${CMAKE_CURRENT_SOURCE_DIR}/../third_party")
if(CMAKE_SYSTEM_NAME STREQUAL "iOS")
    set(PLATFORM_SOURCES src/ios/main.mm src/ios/bundle.mm src/darwin/app_api.mm src/darwin/channels.mm src/darwin/dialogs.mm
        src/darwin/navigation.mm)
elseif(APPLE)
    set(PLATFORM_SOURCES src/darwin/app_api.mm src/darwin/bundle.mm src/darwin/channels.mm src/darwin/dialogs.mm src/darwin/location.mm
        src/darwin/menu.mm src/darwin/navigation.mm src/darwin/update.mm)
elseif(ANDROID)
    set(PLATFORM_SOURCES src/android/jni.cpp)
elseif(WIN32)
    enable_language(RC)
    set(PLATFORM_SOURCES src/windows/app.cpp src/windows/app_api.cpp src/windows/channels.cpp src/windows/com.cpp
        src/windows/instance.cpp src/windows/menu.cpp src/windows/navigation.cpp src/windows/update.cpp src/windows/app.rc)
    # llvm-windres reads a script as Windows-1252, whatever #pragma code_page it holds, and the app's name is UTF-8. It
    # reports no headers either, so a new name, version, manifest or icon would leave the old resources.
    set(RESOURCE_INPUTS "${CMAKE_BINARY_DIR}/crossbind_app.h;${CMAKE_CURRENT_SOURCE_DIR}/src/windows/app.manifest")
    if(EXISTS "${CMAKE_BINARY_DIR}/icon.ico")
        list(APPEND RESOURCE_INPUTS "${CMAKE_BINARY_DIR}/icon.ico")
    endif()
    set_source_files_properties(src/windows/app.rc PROPERTIES COMPILE_OPTIONS --codepage=65001 OBJECT_DEPENDS "${RESOURCE_INPUTS}")
else()
    set(PLATFORM_SOURCES src/linux/app.cpp src/linux/app_api.cpp src/linux/channels.cpp src/linux/menu.cpp src/linux/navigation.cpp
        src/linux/notifications.cpp src/linux/tray.cpp src/linux/update.cpp)
endif()
if(APPLE)
    set(CMAKE_OBJCXX_STANDARD 20)
endif()
# A desktop app checks its updates' signatures with Monocypher, which compiles as C++ as well.
if(NOT ANDROID AND NOT CMAKE_SYSTEM_NAME STREQUAL "iOS")
    set(MONOCYPHER_SOURCES "${THIRD_PARTY}/monocypher/monocypher.c" "${THIRD_PARTY}/monocypher/monocypher-ed25519.c")
    set_source_files_properties(${MONOCYPHER_SOURCES} PROPERTIES LANGUAGE CXX)
endif()

set(SOURCES
    src/app.cpp
    src/app_api.cpp
    src/host_core.cpp
    src/reopen.cpp
    src/updater.cpp
    ${MONOCYPHER_SOURCES}
    ${PLATFORM_SOURCES}
    "${CROSSBIND_JSI_ROOT}/cpp/src/emscripten/bind.cpp"
    ${CROSSBIND_EXTRA_SOURCES})
if(CMAKE_SYSTEM_NAME STREQUAL "iOS")
    add_library(app STATIC src/attach.cpp "${THIRD_PARTY}/jsi/jsi.cpp" ${SOURCES})
elseif(ANDROID)
    add_library(jsi SHARED "${THIRD_PARTY}/jsi/jsi.cpp")
    target_include_directories(jsi PUBLIC "${THIRD_PARTY}/jsi/include")
    add_library(app SHARED ${SOURCES})
else()
    add_executable(app src/main.cpp src/attach.cpp src/instance.cpp "${THIRD_PARTY}/jsi/jsi.cpp" ${SOURCES})
endif()

set_target_properties(app PROPERTIES OUTPUT_NAME "${CROSSBIND_APP_FILE}")
# Only a debug host opens the page of a dev server.
target_compile_definitions(app PRIVATE "$<$<CONFIG:Debug>:CROSSBIND_APP_DEV>")

target_include_directories(app PRIVATE
    src
    # <crossbind/app.h>, which the app's own code includes as well.
    include
    # crossbind_app.h, where the page opens files and a desktop app's name and window, which crossbind writes here.
    "${CMAKE_BINARY_DIR}"
    "${CROSSBIND_HERMES}/include"
    "${CROSSBIND_JSI_ROOT}/cpp/src"
    "${THIRD_PARTY}/webview/core/include"
    "${THIRD_PARTY}/monocypher")
if(APPLE)
    set_source_files_properties(${PLATFORM_SOURCES} PROPERTIES COMPILE_OPTIONS -fobjc-arc)
endif()
if(CMAKE_SYSTEM_NAME STREQUAL "iOS")
    return()
endif()

target_link_libraries(app PRIVATE ${CROSSBIND_LINK_ARGS})
# A force-loaded archive reaches the link as a linker flag, which CMake does not track: without this, a rebuilt bridge
# archive would leave the previous host in place.
set_property(TARGET app APPEND PROPERTY LINK_DEPENDS ${CROSSBIND_LINK_DEPENDS})

if(APPLE)
    # Hermes is a framework the app bundle carries next to the executable. Only what main() and the bindings' static
    # initializers reach stays, without the local symbols of a release build.
    target_link_options(app PRIVATE "-F${CROSSBIND_HERMES}/Library/Frameworks/macosx" "LINKER:-rpath,@executable_path/../Frameworks"
        "LINKER:-dead_strip" "$<$<CONFIG:Release>:LINKER:-x>")
    target_link_libraries(app PRIVATE "-framework hermesvm" "-framework WebKit" "-framework Cocoa" "-framework CoreServices"
        "-framework UniformTypeIdentifiers" "-framework CoreLocation" "-framework Security" "-framework UserNotifications")
elseif(ANDROID)
    # Hermes comes with the app from its own package; the C++ runtime the host shares with it is this NDK's, which goes
    # beside the host, stripped.
    target_link_libraries(app PRIVATE jsi "${CROSSBIND_HERMES}/libs/android.${ANDROID_ABI}/libhermesvm.so" log)
    target_link_options(app PRIVATE "LINKER:--gc-sections" "$<$<CONFIG:Release>:LINKER:-s>")
    target_link_options(jsi PRIVATE "$<$<CONFIG:Release>:LINKER:-s>")
    add_custom_command(TARGET app POST_BUILD
        COMMAND "${CMAKE_STRIP}" -o "$<TARGET_FILE_DIR:app>/libc++_shared.so"
            "${CMAKE_SYSROOT}/usr/lib/${CMAKE_LIBRARY_ARCHITECTURE}/libc++_shared.so")
elseif(WIN32)
    # A window app, linked whole: the system's UCRT is all it loads beside WebView2, which webview finds itself, so no
    # loader DLL ships. WebView2's headers come from crossbind's windows image.
    target_include_directories(app SYSTEM PRIVATE "${CROSSBIND_WEBVIEW2_INCLUDE}")
    target_link_libraries(app PRIVATE "${CROSSBIND_HERMES}/lib/libhermesvm_a.a"
        ole32 oleaut32 uuid shell32 shlwapi user32 gdi32 advapi32 version dwmapi winmm winhttp comctl32 wintrust crypt32)
    set_target_properties(app PROPERTIES WIN32_EXECUTABLE ON)
    # Some DLLs the app imports, as version, winhttp and wintrust, are no known DLLs, which Windows looks for in the app's
    # folder first: a file of their name there, as in a folder the app was downloaded to, would run inside the app. They
    # load from System32 alone.
    target_link_options(app PRIVATE -static "LINKER:--gc-sections" "LINKER:--dependent-load-flag=0x800" "$<$<CONFIG:Release>:LINKER:-s>")
else()
    # WebKitGTK comes from the Ubuntu 22.04 packages crossbind downloads: its headers are searched after the C library's,
    # which the image's glibc 2.28 sysroot keeps, and its libraries are only linked against, as the system's load at run
    # time.
    set(GTK_LIB "${CROSSBIND_GTK_SYSROOT}/usr/lib/${CROSSBIND_GTK_MULTIARCH}")
    foreach(dir webkitgtk-4.1 libsoup-3.0 gtk-3.0 at-spi2-atk/2.0 at-spi-2.0 dbus-1.0 gio-unix-2.0 cairo pango-1.0 harfbuzz
            fribidi atk-1.0 pixman-1 uuid freetype2 gdk-pixbuf-2.0 libpng16 libmount blkid glib-2.0)
        target_include_directories(app SYSTEM PRIVATE "${CROSSBIND_GTK_SYSROOT}/usr/include/${dir}")
    endforeach()
    target_include_directories(app SYSTEM PRIVATE "${GTK_LIB}/glib-2.0/include" "${GTK_LIB}/dbus-1.0/include")
    target_compile_options(app PRIVATE "SHELL:-idirafter ${CROSSBIND_GTK_SYSROOT}/usr/include")
    target_link_directories(app PRIVATE "${GTK_LIB}")
    target_link_libraries(app PRIVATE "${CROSSBIND_HERMES}/lib/libhermesvm_a.a" "${CROSSBIND_HERMES}/lib/libboost_context.a"
        -Wl,--as-needed webkit2gtk-4.1 javascriptcoregtk-4.1 soup-3.0 gtk-3 gdk-3 gio-2.0 gobject-2.0 glib-2.0 pthread dl)
    # The static libc++ stays inside: WebKitGTK loads the system's libstdc++, which must not bind to it.
    target_link_options(app PRIVATE "LINKER:--allow-shlib-undefined" "LINKER:--exclude-libs,ALL" "LINKER:--gc-sections"
        "$<$<CONFIG:Release>:LINKER:-s>")
endif()
