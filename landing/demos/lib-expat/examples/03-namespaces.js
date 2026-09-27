export const title = 'Read namespaced XML whatever the prefixes';
export const summary = 'XML_ParserCreateNS resolves every prefix to its namespace URI before your handlers see a name, and XML_SetStartNamespaceDeclHandler reports the declarations themselves.';
export const native = 'xml_names.h';
export const expected = [
    'gpxtpx:hr 128 131',
    'ns3:hr 128 131',
    'hr in the GPX namespace: 0',
    '{"":"http://www.topografix.com/GPX/1/1","ns3":"http://www.garmin.com/xmlschemas/TrackPointExtension/v1"}',
];

export default async function example({ XmlNames }, console) {
    const GPX = 'http://www.topografix.com/GPX/1/1';
    const HR = 'http://www.garmin.com/xmlschemas/TrackPointExtension/v1';
    // The same heart rates, written by two exporters that picked different prefixes for Garmin's extension.
    const track = (prefix) => `<gpx version="1.1" creator="example" xmlns="${GPX}" xmlns:${prefix}="${HR}">
        <trk><trkseg>
            <trkpt lat="46.5190" lon="6.5668"><extensions><${prefix}:TrackPointExtension><${prefix}:hr>128</${prefix}:hr></${prefix}:TrackPointExtension></extensions></trkpt>
            <trkpt lat="46.5192" lon="6.5671"><extensions><${prefix}:TrackPointExtension><${prefix}:hr>131</${prefix}:hr></${prefix}:TrackPointExtension></extensions></trkpt>
        </trkseg></trk>
    </gpx>`;
    for (const prefix of ['gpxtpx', 'ns3']) {
        const rates = JSON.parse(await XmlNames.textOf(track(prefix), HR, 'hr'));
        console.log(`${prefix}:hr`, rates.join(' '));
    }
    console.log('hr in the GPX namespace:', JSON.parse(await XmlNames.textOf(track('gpxtpx'), GPX, 'hr')).length);
    console.log(await XmlNames.declarations(track('ns3')));
}
