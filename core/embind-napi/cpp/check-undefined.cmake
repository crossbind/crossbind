# A Linux shared object may leave symbols undefined, and the loader binds functions lazily: an addon
# that misses an archive loads, then dies at its first call into the missing code. Every undefined
# symbol has to be a Node-API function or carry the version of a system library that defines it.
execute_process(
    COMMAND "${NM}" -D --undefined-only "${ADDON}"
    OUTPUT_VARIABLE listing
    COMMAND_ERROR_IS_FATAL ANY)
string(REPLACE "\n" ";" lines "${listing}")
set(unresolved)
foreach(line IN LISTS lines)
    if(line MATCHES "^ *U ([^@ ]+)$" AND NOT CMAKE_MATCH_1 MATCHES "^(napi|node_api)_")
        list(APPEND unresolved "${CMAKE_MATCH_1}")
    endif()
endforeach()
if(unresolved)
    list(JOIN unresolved ", " names)
    message(FATAL_ERROR "crossbind: ${ADDON} leaves symbols no archive defines: ${names}")
endif()
