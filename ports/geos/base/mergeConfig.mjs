export default (newConfig = {}) => ({
    ...newConfig,
    general: {
        name: 'geos',
        alias: { package: '@crossbind/port-geos' },
    },
    export: {
        type: 'cmake',
        bundle: false,
        libName: ['geos', 'geos_c'],
        // GEOS C++ headers forward-declare the geometry classes their signatures use; bindings need them complete.
        // These are the headers geos/geom.h includes: geos/geom.h itself adds `using namespace geos::geom` globally.
        headerPrelude: [
            'geos/geom/Coordinate.h', 'geos/geom/CoordinateFilter.h', 'geos/geom/CoordinateSequence.h', 'geos/geom/Dimension.h',
            'geos/geom/Envelope.h', 'geos/geom/Geometry.h', 'geos/geom/GeometryCollection.h', 'geos/geom/GeometryComponentFilter.h',
            'geos/geom/GeometryFactory.h', 'geos/geom/GeometryFilter.h', 'geos/geom/LineString.h', 'geos/geom/LinearRing.h',
            'geos/geom/MultiLineString.h', 'geos/geom/MultiPoint.h', 'geos/geom/MultiPolygon.h', 'geos/geom/Point.h',
            'geos/geom/Polygon.h', 'geos/geom/PrecisionModel.h', 'geos/geom/LineSegment.h', 'geos/geom/IntersectionMatrix.h',
            'geos/geom/Location.h',
        ],
        ...(newConfig.export || {}),
    },
    paths: {
        output: 'dist',
        base: '../..',
        ...(newConfig.paths || {}),
    },
});
