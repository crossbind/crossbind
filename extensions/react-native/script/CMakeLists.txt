cmake_minimum_required(VERSION 3.28)

execute_process(
    COMMAND node ${CMAKE_SOURCE_DIR}/getCliPath.js
    WORKING_DIRECTORY ${CROSSBIND_PROJECT_PATH}
    OUTPUT_VARIABLE NODE_OUTPUT
    OUTPUT_STRIP_TRAILING_WHITESPACE
    RESULT_VARIABLE NODE_RESULT
)

if(NODE_RESULT)
    message(FATAL_ERROR "Node script failed")
endif()

set(CROSSBIND_CLI_PATH "${NODE_OUTPUT}")

execute_process(
    COMMAND node ${CMAKE_SOURCE_DIR}/build_js.js android
    WORKING_DIRECTORY ${CROSSBIND_PROJECT_PATH}
    RESULT_VARIABLE NODE_RESULT
)

if(NODE_RESULT)
    message(FATAL_ERROR "Node script failed")
endif()

# build_android.js writes the parameter list to a file instead of stdout, so crossbind
# log lines can never corrupt the parsing below.
set(CROSSBIND_PARAMS_FILE "${CMAKE_CURRENT_BINARY_DIR}/crossbind-cmake-params.txt")
execute_process(
    COMMAND node ${CMAKE_SOURCE_DIR}/build_android.js ${ANDROID_ABI} ${CMAKE_BUILD_TYPE} ${CROSSBIND_PARAMS_FILE}
    WORKING_DIRECTORY ${CROSSBIND_PROJECT_PATH}
    RESULT_VARIABLE NODE_RESULT
)

if(NODE_RESULT)
    message(FATAL_ERROR "Node script failed")
endif()

# One -DKEY=VALUE per line; file(STRINGS) escapes embedded semicolons so list
# values (globs, search paths) survive intact.
file(STRINGS "${CROSSBIND_PARAMS_FILE}" CROSSBIND_PARAM_LINES)

foreach(arg IN LISTS CROSSBIND_PARAM_LINES)
    if("${arg}" STREQUAL "")
        continue()
    endif()
    string(SUBSTRING "${arg}" 2 -1 def)
    string(FIND "${def}" "=" eq_pos)

    if(eq_pos EQUAL -1)
        set(key "${def}")
        set(value "")
    else()
        string(SUBSTRING "${def}" 0 ${eq_pos} key)
        math(EXPR val_pos "${eq_pos} + 1")
        string(SUBSTRING "${def}" ${val_pos} -1 value)
    endif()

    set(${key} "${value}")
    message("${key} = ${value}")
endforeach()

message("PROJECT_NAME = ${PROJECT_NAME}")

# build_android_deps.js (gradle task crossbindDeps) refreshes this stamp whenever the
# consumed rebuilt-dependency set changes; registering it as a configure dependency
# makes ninja re-run CMake automatically — no gradle-argument tricks needed.
set(CROSSBIND_DEPS_STAMP_FILE "${CROSSBIND_PROJECT_PATH}/.crossbind/deps-stamp")
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${CROSSBIND_DEPS_STAMP_FILE}")
if(EXISTS "${CROSSBIND_DEPS_STAMP_FILE}")
    file(READ "${CROSSBIND_DEPS_STAMP_FILE}" CROSSBIND_DEPS_STAMP)
endif()
message("CROSSBIND_DEPS_STAMP = ${CROSSBIND_DEPS_STAMP}")

include("${CROSSBIND_CLI_PATH}/assets/cmake/CMakeLists.txt")

if(ANDROID)
    find_package(ReactAndroid REQUIRED CONFIG)
    find_package(fbjni REQUIRED CONFIG)
    target_link_libraries("${PROJECT_NAME}"
        ReactAndroid::jsi
        ReactAndroid::reactnative
        fbjni::fbjni)

    # App-local Rust staticlibs (build_android.js): whole-archive so their init-array
    # registration constructors survive dead-strip (nothing references them by symbol).
    if(DEFINED CROSSBIND_RUST_APP_LIBS AND NOT "${CROSSBIND_RUST_APP_LIBS}" STREQUAL "")
        string(REPLACE ";" "," CROSSBIND_RUST_APP_LIBS_COMMA "${CROSSBIND_RUST_APP_LIBS}")
        target_link_libraries("${PROJECT_NAME}" "$<LINK_LIBRARY:WHOLE_ARCHIVE,${CROSSBIND_RUST_APP_LIBS_COMMA}>")
    endif()
endif()
