// App-local Rust surface using an UPSTREAM crate directly (no crossbind package): the app config
// declares `packages.cargo` (geo, wkt) and this file consumes them - exactly
// like writing your own native.h classes over a linked C library.
use geo::{Area, ConvexHull};
use geo::{Geometry, MultiPoint, Polygon};
use wkt::{ToWkt, TryFromWkt};

pub struct Hull {
    points: Option<MultiPoint<f64>>,
}

impl Hull {
    pub fn from_wkt(wkt_text: String) -> Self {
        let points = match Geometry::<f64>::try_from_wkt_str(&wkt_text) {
            Ok(Geometry::MultiPoint(m)) => Some(m),
            _ => None,
        };
        Hull { points }
    }
    pub fn is_valid(&self) -> bool {
        self.points.is_some()
    }
    pub fn hull_area(&self) -> f64 {
        self.hull().map(|h| h.unsigned_area()).unwrap_or(0.0)
    }
    pub fn hull_wkt(&self) -> String {
        self.hull().map(|h| h.wkt_string()).unwrap_or_default()
    }
}

impl Hull {
    fn hull(&self) -> Option<Polygon<f64>> {
        self.points.as_ref().map(|m| m.convex_hull())
    }
}
