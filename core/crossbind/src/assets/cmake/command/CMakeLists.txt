cmake_minimum_required(VERSION 3.20)
project(crossbind_command CXX)

# main() comes from the project's archive, which CROSSBIND_LINK_ARGS links whole; this source only
# gives CMake a target to link.
add_executable(command command.cpp)
set_target_properties(command PROPERTIES OUTPUT_NAME "${CROSSBIND_COMMAND_FILE}" SUFFIX "")
target_link_libraries(command PRIVATE ${CROSSBIND_LINK_ARGS})
# A whole-archive input reaches the link as a linker flag, which CMake does not track.
set_property(TARGET command APPEND PROPERTY LINK_DEPENDS ${CROSSBIND_LINK_DEPENDS})

if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
    find_package(Threads REQUIRED)
    target_link_libraries(command PRIVATE Threads::Threads ${CMAKE_DL_LIBS})
endif()

# A musl executable links fully static, so one binary runs on every Linux distribution; MinGW keeps
# its C++ runtime and winpthreads in the executable, as the addon does.
if(CROSSBIND_STATIC OR MINGW)
    target_link_options(command PRIVATE -static)
endif()
