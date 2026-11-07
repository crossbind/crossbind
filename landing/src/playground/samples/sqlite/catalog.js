// The site's library catalog as the home page's demo holds it: the same libraries, categories and order.
export const catalogAsSql = `
create table libraries (name text, category text);
insert into libraries values
    ('cURL', 'Networking'),
    ('Expat', 'Text'),
    ('GDAL', 'Geospatial'),
    ('GEOS', 'Geospatial'),
    ('GeoTIFF', 'Geospatial'),
    ('iconv', 'Text'),
    ('LERC', 'Imaging'),
    ('libjpeg-turbo', 'Imaging'),
    ('libTIFF', 'Imaging'),
    ('OpenSSL', 'Crypto and TLS'),
    ('PROJ', 'Geospatial'),
    ('SpatiaLite', 'Database'),
    ('SQLite', 'Database'),
    ('WebP', 'Imaging'),
    ('zlib', 'Compression'),
    ('Zstandard', 'Compression');
`;
