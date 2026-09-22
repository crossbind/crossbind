cmake_minimum_required(VERSION 3.28)
set(CMAKE_CXX_STANDARD 20)
project("${PROJECT_NAME}")

option(BUILD_BRIDGE "Build Bridge" OFF)
option(BUILD_SOURCE "Build Source" OFF)

foreach(depend IN ZIP_LISTS DEPENDS_CMAKE_PATHS DEPENDS_CMAKE_NAMES)
    # Source-cmake packages are linked (and their PUBLIC includes propagated) by this exact
    # name below, so their CMakeLists must create the target as CROSSBIND_LIB_NAME.
    set(CROSSBIND_LIB_NAME "${depend_1}")
    add_subdirectory("${depend_0}" "${CMAKE_CURRENT_BINARY_DIR}/dependencies/${depend_1}")
endforeach()

if (BUILD_SOURCE)
    file(GLOB_RECURSE BUILD_SRC_FILES ${NATIVE_GLOB})
endif(BUILD_SOURCE)

if (BUILD_BRIDGE)
    file(GLOB BRIDGE_SRC_FILES "${BRIDGE_DIR}/*.i.cpp;${EXTERNAL_BRIDGE_GLOB}")
endif(BUILD_BRIDGE)

file(GLOB_RECURSE EXTERNAL_SRC_FILES ${EXTERNAL_NATIVE_GLOB})

set(SRC_FILES "${BUILD_SRC_FILES}" "${BRIDGE_SRC_FILES}" "${EXTERNAL_SRC_FILES}")
add_library("${PROJECT_NAME}" "${BUILD_TYPE}" ${SRC_FILES})

set(EXTRA_LINK_LIBRARIES "")
if(ANDROID)
    set(EXTRA_LINK_LIBRARIES "log")
endif()

if (NOT ${COMPILE_OPTIONS} STREQUAL "")
    target_compile_options("${PROJECT_NAME}" PUBLIC "${COMPILE_OPTIONS}")
endif()

if (NOT ${CMAKE_SYSTEM_NAME} STREQUAL "")
    target_link_libraries("${PROJECT_NAME}" "${DEPENDS_CMAKE_NAMES}" "${EXTRA_LINK_LIBRARIES}")
endif()

file(GLOB_RECURSE HEADER_FILES ${HEADER_GLOB})
target_include_directories("${PROJECT_NAME}" PUBLIC "${HEADER_DIR}")

install(TARGETS "${PROJECT_NAME}" DESTINATION "lib")
if(NOT "${HEADER_FILES}" STREQUAL "")
    target_sources("${PROJECT_NAME}"
        PUBLIC FILE_SET HEADERS
        BASE_DIRS "${HEADER_DIR}"
        FILES "${HEADER_FILES}")
    install(TARGETS "${PROJECT_NAME}" FILE_SET HEADERS DESTINATION "include")
endif()

if (BUILD_SOURCE)

endif(BUILD_SOURCE)
unset(BUILD_SOURCE CACHE)

if (BUILD_BRIDGE)
    install(TARGETS "${PROJECT_NAME}")
endif(BUILD_BRIDGE)
unset(BUILD_BRIDGE CACHE)
