// Every name the examples import, from the header the site says it comes from. The build fails on a
// name that header does not export, so the import lines on the page are checked here.
export {
    XML_ErrorString,
    XML_ExpatVersion,
    XML_GetBuffer,
    XML_GetCurrentColumnNumber,
    XML_GetCurrentLineNumber,
    XML_GetErrorCode,
    XML_Parse,
    XML_ParseBuffer,
    XML_ParserCreate,
    XML_ParserCreateNS,
    XML_ParserFree,
    XML_SetCharacterDataHandler,
    XML_SetElementHandler,
    XML_SetStartElementHandler,
    XML_SetStartNamespaceDeclHandler,
    XML_Status,
    readCString,
    readPointerAt,
    releaseCallback,
    writeBytes,
} from '@crossbind/port-expat/expat.h';
