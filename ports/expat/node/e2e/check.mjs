import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
    XML_ExpatVersion, XML_ParserCreate, XML_ParserFree, XML_SetElementHandler, XML_Parse, XML_GetErrorCode, XML_ErrorString,
    XML_Status, XML_Error, AllSymbols,
} from '@crossbind/port-expat-node/expat.h';

// The expected values come from elsewhere: the version from package.json, the elements and the error from the input.
const { readCString } = AllSymbols;
const DOCUMENT = '<a><b x="1"/><b/></a>';
const MISMATCHED = '<a><b></a>';

const parse = (text, onStart = () => {}) => {
    const parser = XML_ParserCreate(null);
    XML_SetElementHandler(parser, (userData, name) => onStart(name), () => {});
    const status = XML_Parse(parser, text, text.length, 1);
    const error = XML_GetErrorCode(parser);
    XML_ParserFree(parser);
    return { status, error };
};

const names = [];
assert.equal(parse(DOCUMENT, (name) => names.push(name)).status.value, XML_Status.XML_STATUS_OK.value);
assert.deepEqual(names, ['a', 'b', 'b']);

const { status, error } = parse(MISMATCHED);
assert.equal(status.value, XML_Status.XML_STATUS_ERROR.value);
assert.equal(error.value, XML_Error.XML_ERROR_TAG_MISMATCH.value);
assert.equal(readCString(XML_ErrorString(error)), 'mismatched tag');

assert.equal(readCString(XML_ExpatVersion()), `expat_${process.env.NATIVE_VERSION}`);
assert.equal(createRequire(import.meta.url)('@crossbind/port-expat-node/expat.h').XML_Parse, XML_Parse);
console.log(`ok: ${readCString(XML_ExpatVersion())} on ${process.platform}-${process.arch}`);
