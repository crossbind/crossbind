/* Typed forms of libtiff's variadic field calls, added by crossbind: JavaScript bindings cannot pass C varargs, so each
 * value type gets a function of its own. The tag still decides which type it takes; float tags are set as double. */
#ifndef TIFFIO_CROSSBIND_H
#define TIFFIO_CROSSBIND_H

#include <tiffio.h>

static inline int TIFFSetFieldUInt16(TIFF *tif, uint32_t tag, uint16_t value)
{
    return TIFFSetField(tif, tag, value);
}

static inline int TIFFSetFieldUInt32(TIFF *tif, uint32_t tag, uint32_t value)
{
    return TIFFSetField(tif, tag, value);
}

static inline int TIFFSetFieldDouble(TIFF *tif, uint32_t tag, double value)
{
    return TIFFSetField(tif, tag, value);
}

static inline int TIFFSetFieldString(TIFF *tif, uint32_t tag, const char *value)
{
    return TIFFSetField(tif, tag, value);
}

static inline int TIFFGetFieldUInt16(TIFF *tif, uint32_t tag, uint16_t *value)
{
    return TIFFGetField(tif, tag, value);
}

static inline int TIFFGetFieldUInt32(TIFF *tif, uint32_t tag, uint32_t *value)
{
    return TIFFGetField(tif, tag, value);
}

static inline int TIFFGetFieldFloat(TIFF *tif, uint32_t tag, float *value)
{
    return TIFFGetField(tif, tag, value);
}

static inline int TIFFGetFieldDouble(TIFF *tif, uint32_t tag, double *value)
{
    return TIFFGetField(tif, tag, value);
}

static inline int TIFFGetFieldString(TIFF *tif, uint32_t tag, char **value)
{
    return TIFFGetField(tif, tag, value);
}

static inline int TIFFGetFieldDefaultedUInt16(TIFF *tif, uint32_t tag, uint16_t *value)
{
    return TIFFGetFieldDefaulted(tif, tag, value);
}

static inline int TIFFGetFieldDefaultedUInt32(TIFF *tif, uint32_t tag, uint32_t *value)
{
    return TIFFGetFieldDefaulted(tif, tag, value);
}

#endif
