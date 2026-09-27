import { GeoPackageExport } from './spatialite/geopackage.jsx';
import { SqlPlayground } from './spatialite/playground.jsx';
import { SqlRouting } from './spatialite/routing.jsx';

// The SpatiaLite apps on /ports/spatialite/. Each one drives landing/demos/lib-spatialite, whose
// index.html checks the same calls against answers worked out without SpatiaLite: the generated
// points recomputed in plain Python, distances from PROJ's geod, geometry from shapely and pyproj,
// routes from a plain Dijkstra, and the GeoPackage read back by GDAL.

export const SPATIALITE_APPS = [SqlPlayground, SqlRouting, GeoPackageExport];
