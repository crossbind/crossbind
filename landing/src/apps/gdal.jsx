import { VectorConverterApp } from './gdal/converter.jsx';
import { PixelsToPolygonsApp } from './gdal/polygons.jsx';
import { TerrainStudioApp } from './gdal/terrain.jsx';

// The GDAL apps on /ports/gdal/. Each one drives landing/demos/lib-gdal, whose index.html checks the
// same calls against the host's own GDAL 3.13.0 on the same inputs: its ogr2ogr and ogrinfo for the
// converter, gdaldem, gdal_contour and gdal_viewshed for the terrain, gdal_sieve.py and
// gdal_polygonize.py for the traced pixels.

export const GDAL_APPS = [VectorConverterApp, TerrainStudioApp, PixelsToPolygonsApp];
