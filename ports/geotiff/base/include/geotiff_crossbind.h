/* Typed forms of libgeotiff's variadic GTIFKeySet, added by crossbind: JavaScript bindings cannot pass C varargs, so
 * each key type gets a function of its own. */
#ifndef GEOTIFF_CROSSBIND_H
#define GEOTIFF_CROSSBIND_H

#include <geotiff.h>

static inline int GTIFKeySetShort(GTIF *gtif, geokey_t key, unsigned short value)
{
    return GTIFKeySet(gtif, key, TYPE_SHORT, 1, value);
}

static inline int GTIFKeySetDouble(GTIF *gtif, geokey_t key, double value)
{
    return GTIFKeySet(gtif, key, TYPE_DOUBLE, 1, value);
}

static inline int GTIFKeySetAscii(GTIF *gtif, geokey_t key, const char *value)
{
    return GTIFKeySet(gtif, key, TYPE_ASCII, 0, value);
}

#endif
