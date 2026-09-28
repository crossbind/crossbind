set(MY_LIST "___PROJECT_HOST___")
LIST(FIND MY_LIST "${PROJECT_TARGET_HOST}" PACKAGE_HOST_INDEX)
if(PACKAGE_HOST_INDEX EQUAL -1)
    set(PROJECT_TARGET_HOST "${PROJECT_TARGET_HOST_RELEASE}")
endif()
LIST(FIND MY_LIST "${PROJECT_TARGET_HOST}" PACKAGE_HOST_INDEX)

if(NOT PACKAGE_HOST_INDEX EQUAL -1)
    cmake_minimum_required(VERSION 3.28)
    set(CMAKE_CXX_STANDARD 11)
    set(PROJECT_NAME "___PROJECT_NAME___")
    set(PROJECT_LIBS "___PROJECT_LIBS___")
    project("${PROJECT_NAME}")

    if (APPLE AND CMAKE_SYSTEM_NAME STREQUAL "iOS")
        set(PACKAGE_DIR "${PROJECT_SOURCE_DIR}/../..")
    else()
        set(PACKAGE_DIR "${PROJECT_SOURCE_DIR}/${PROJECT_TARGET_HOST}/lib")
    endif()

    set(PROJECT_LIBS_DIR)
    foreach(L IN LISTS PROJECT_LIBS)
        SET(FOUND_LIB "FOUND_LIB-NOTFOUND")
        find_library(FOUND_LIB
            NAMES "${L}"
            PATHS "${PACKAGE_DIR}"
            NO_CACHE
            NO_DEFAULT_PATH
            NO_CMAKE_FIND_ROOT_PATH
            REQUIRED
        )
        LIST(APPEND PROJECT_LIBS_DIR ${FOUND_LIB})
    endforeach()

    add_library("${PROJECT_NAME}" INTERFACE)
    # Cargo producers register through an init-array constructor nothing references. KEEP pins the
    # generated keep symbol (--undefined) so only the registration object is pulled - never the
    # whole archive, because each Rust staticlib bundles libstd and fully loading two of them
    # duplicates thousands of std symbols. FORCE (manual-bindings crates, no keep symbol) falls
    # back to whole-archive - safe only as the app's single loaded Rust archive. (Apple consumers
    # get the equivalent flags from the generated podspec instead.)
    set(PROJECT_RUST_LINK "___PROJECT_WHOLE_ARCHIVE___")
    if(PROJECT_RUST_LINK STREQUAL "KEEP" AND NOT APPLE)
        target_link_libraries("${PROJECT_NAME}" INTERFACE "${PROJECT_LIBS_DIR}")
        foreach(L IN LISTS PROJECT_LIBS)
            target_link_options("${PROJECT_NAME}" INTERFACE "-Wl,--undefined=crossbind_keep_${L}")
        endforeach()
    elseif(PROJECT_RUST_LINK STREQUAL "FORCE" AND NOT APPLE)
        target_link_libraries("${PROJECT_NAME}" INTERFACE "$<LINK_LIBRARY:WHOLE_ARCHIVE,${PROJECT_LIBS_DIR}>")
    else()
        target_link_libraries("${PROJECT_NAME}" INTERFACE "${PROJECT_LIBS_DIR}")
    endif()

    if(NOT (APPLE AND CMAKE_SYSTEM_NAME STREQUAL "iOS"))
        target_include_directories("${PROJECT_NAME}" INTERFACE "${PROJECT_SOURCE_DIR}/${PROJECT_TARGET_HOST}/include")
    endif()
endif()
