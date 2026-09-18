export default {
    sha256: 'd5e5192a686d065eaed082de14dd26244c5c8e02bff16b2c6cce3265f648e00e', // geos-3.15.0.tar.bz2
    getURL: (version) => `https://download.osgeo.org/geos/geos-${version}.tar.bz2`,
    // wasi-sdk 34 libc++ include hygiene; a no-op elsewhere - re-check on GEOS bumps.
    replaceList: [
        {
            regex: '#include <cassert>',
            replacement: '#include <cassert>\n#include <type_traits>',
            paths: ['include/geos/geom/CoordinateSequence.h'],
        },
        {
            regex: '#include <cstdint>',
            replacement: '#include <cstdint>\n#include <algorithm>',
            paths: ['include/geos/algorithm/distance/DiscreteFrechetDistance.h'],
        },
        {
            regex: '#include <geos/geom/Geometry.h>',
            replacement: '#include <algorithm>\n#include <geos/geom/Geometry.h>',
            paths: ['include/geos/index/strtree/TemplateSTRtree.h'],
        },
        {
            regex: '#include <geos/export.h>',
            replacement: '#include <geos/export.h>\n#include <algorithm>',
            paths: ['include/geos/shape/fractal/HilbertEncoder.h'],
        },
    ],
    buildType: 'cmake',
    getBuildParams: (target) => [
        '-DBUILD_TESTING=OFF',
        '-DBUILD_GEOSOP=OFF',
    ],
};
