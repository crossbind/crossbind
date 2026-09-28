cmake_minimum_required(VERSION 3.28)
project(crossbind_node_addon CXX)

# crossbind configures this project for one Node-API addon: the embind runtime and its Node-API
# host compile here, the project's own code arrives as prebuilt archives in CROSSBIND_LINK_ARGS.

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(NODE_API_JSI "${CMAKE_CURRENT_SOURCE_DIR}/../third_party/node-api-jsi")

if(WIN32)
    set(NODE_API_LOADER "${NODE_API_JSI}/src/ApiLoaders/NodeApi_win.cpp")
else()
    set(NODE_API_LOADER "${NODE_API_JSI}/src/ApiLoaders/NodeApi_posix.cpp")
endif()

add_library(addon MODULE
    src/node_api_module.cpp
    "${NODE_API_JSI}/src/NodeApiJsiRuntime.cpp"
    "${NODE_API_JSI}/src/ApiLoaders/NodeApi.cpp"
    "${NODE_API_LOADER}"
    "${NODE_API_JSI}/src/ApiLoaders/JSRuntimeApi.cpp"
    "${NODE_API_JSI}/jsi/jsi/jsi.cpp"
    "${CROSSBIND_JSI_ROOT}/cpp/src/emscripten/bind.cpp"
    ${CROSSBIND_EXTRA_SOURCES})

set_target_properties(addon PROPERTIES PREFIX "" SUFFIX "" OUTPUT_NAME "${CROSSBIND_ADDON_FILE}")

target_include_directories(addon PRIVATE
    "${NODE_API_JSI}/src"
    "${NODE_API_JSI}/node-api"
    "${NODE_API_JSI}/jsi"
    "${CROSSBIND_JSI_ROOT}/cpp/src")

target_link_libraries(addon PRIVATE ${CROSSBIND_LINK_ARGS})
# A force-loaded archive reaches the link as a linker flag, which CMake does not track: without
# this, a rebuilt bridge archive would leave the previous addon in place.
set_property(TARGET addon APPEND PROPERTY LINK_DEPENDS ${CROSSBIND_LINK_DEPENDS})

# glibc 2.28 keeps threads and dlopen in libraries of their own. The archives' symbols stay private
# to the addon: node exports its own OpenSSL and zlib, and an exported copy here would trade calls
# with them.
if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
    find_package(Threads REQUIRED)
    target_link_libraries(addon PRIVATE Threads::Threads ${CMAKE_DL_LIBS})
    target_link_options(addon PRIVATE "LINKER:--exclude-libs,ALL")
    add_custom_command(TARGET addon POST_BUILD
        COMMAND "${CMAKE_COMMAND}" "-DNM=${CMAKE_NM}" "-DADDON=$<TARGET_FILE:addon>"
            -P "${CMAKE_CURRENT_SOURCE_DIR}/check-undefined.cmake"
        VERBATIM)
endif()

# The C++ runtime, its unwinder and winpthreads go into the addon; the CRT stays the system's UCRT.
# node-api-jsi's pooled values call the sized operator delete, which clang leaves off for MinGW.
if(MINGW)
    target_compile_options(addon PRIVATE -fsized-deallocation)
    target_link_options(addon PRIVATE -static)
endif()

# Node-API symbols resolve against the node (or Electron) process that loads the addon. Everything
# else must resolve at link time, so a stale or missing archive fails the build instead of the load.
if(APPLE)
    file(STRINGS "${NODE_API_JSI}/src/ApiLoaders/NodeApi.inc" NODE_API_FUNCS REGEX "^NODE_API_FUNC\\(")
    foreach(line IN LISTS NODE_API_FUNCS)
        string(REGEX REPLACE "^NODE_API_FUNC\\(([A-Za-z0-9_]+)\\).*" "\\1" func "${line}")
        target_link_options(addon PRIVATE "LINKER:-U,_${func}")
    endforeach()
endif()
