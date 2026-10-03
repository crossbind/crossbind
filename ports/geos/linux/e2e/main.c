#include <stdio.h>
#include <geos_c.h>

static void quiet(const char *fmt, ...) { (void)fmt; }

int main(void)
{
    initGEOS(quiet, quiet);
    GEOSWKTReader *r = GEOSWKTReader_create();
    GEOSGeometry *a = GEOSWKTReader_read(r, "POLYGON((0 0,10 0,10 10,0 10,0 0))");
    GEOSGeometry *b = GEOSWKTReader_read(r, "POLYGON((5 5,15 5,15 15,5 15,5 5))");
    if (!a || !b) return 1;
    GEOSGeometry *i = GEOSIntersection(a, b);
    double area = 0;
    if (!i || !GEOSArea(i, &area)) return 2;
    if (area < 24.999 || area > 25.001) return 3;
    printf("geos %s: PASS (intersection area = 25)\n", GEOSversion());
    GEOSGeom_destroy(i);
    GEOSGeom_destroy(b);
    GEOSGeom_destroy(a);
    GEOSWKTReader_destroy(r);
    finishGEOS();
    return 0;
}
