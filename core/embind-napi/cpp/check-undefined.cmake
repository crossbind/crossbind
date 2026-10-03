# A Linux shared object may leave symbols undefined, and the loader binds functions lazily: an addon
# that misses an archive loads, then dies at its first call into the missing code. Every undefined
# symbol has to be a Node-API function or carry the version of a system library that defines it.
# musl versions nothing, so a name its C library (UNVERSIONED_LIBRARIES) defines passes as it is.
set(defined)
foreach(library IN LISTS UNVERSIONED_LIBRARIES)
    execute_process(
        COMMAND "${NM}" -D --defined-only "${library}"
        OUTPUT_VARIABLE exports
        COMMAND_ERROR_IS_FATAL ANY)
    string(REPLACE "\n" ";" export_lines "${exports}")
    foreach(export_line IN LISTS export_lines)
        if(export_line MATCHES " ([^ ]+)$")
            list(APPEND defined "${CMAKE_MATCH_1}")
        endif()
    endforeach()
endforeach()
execute_process(
    COMMAND "${NM}" -D --undefined-only "${ADDON}"
    OUTPUT_VARIABLE listing
    COMMAND_ERROR_IS_FATAL ANY)
string(REPLACE "\n" ";" lines "${listing}")
set(unresolved)
foreach(line IN LISTS lines)
    if(NOT line MATCHES "^ *U ([^@ ]+)$")
        continue()
    endif()
    # A failed MATCHES clears CMAKE_MATCH_1, so the name is kept before the next one.
    set(symbol "${CMAKE_MATCH_1}")
    list(FIND defined "${symbol}" index)
    if(NOT symbol MATCHES "^(napi|node_api)_" AND index EQUAL -1)
        list(APPEND unresolved "${symbol}")
    endif()
endforeach()
if(unresolved)
    list(JOIN unresolved ", " names)
    message(FATAL_ERROR "crossbind: ${ADDON} leaves symbols no archive defines: ${names}")
endif()
