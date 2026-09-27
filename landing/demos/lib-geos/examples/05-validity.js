export const title = 'Find why a polygon is invalid and repair it';
export const summary = 'GEOSisValid_r and GEOSisValidReason_r say whether a shape breaks the OGC rules, what is wrong and where. GEOSMakeValidWithParams_r repairs it two ways, which agree on a bowtie and differ on a hole that leaks out of its shell.';
export const native = 'validity.h';
export const expected = [
    'false Self-intersection[5 5]',
    'MULTIPOLYGON (((5 5, 10 10, 10 0, 5 5)), ((0 0, 0 10, 5 5, 0 0))) true 50',
    'Self-intersection[5 10]',
    'linework 150',
    'structure 75',
];

export default async function example({ Validity, Measure }, console) {
    const bowtie = 'POLYGON ((0 0, 10 10, 10 0, 0 10, 0 0))';
    console.log(await Validity.isValid(bowtie), await Validity.reason(bowtie));
    const repaired = await Validity.makeValid(bowtie, 'linework');
    console.log(repaired, await Validity.isValid(repaired), await Measure.area(repaired));
    const leaky = 'POLYGON ((0 0, 10 0, 10 10, 0 10, 0 0), (5 5, 15 5, 15 15, 5 15, 5 5))';
    console.log(await Validity.reason(leaky));
    for (const method of ['linework', 'structure']) {
        console.log(method, await Measure.area(await Validity.makeValid(leaky, method)));
    }
}
