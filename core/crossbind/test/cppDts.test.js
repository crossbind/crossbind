import { describe, test, expect } from 'vitest';
import { parseCppSurface, emitCppDts } from '../src/utils/cppDts.js';

const HEADER = `
#ifndef _SAMPLE_H
#define _SAMPLE_H

#include <memory>
#include <string>
#include <vector>

// A regular binding-rules class.
class Matrix : public std::vector<int> {
public:
    Matrix(int size, int initValue) : std::vector<int>(size, initValue) {}
    int get(int i);
    std::shared_ptr<Matrix> multiple(std::shared_ptr<Matrix> b);
    static std::string describe(const std::string& name, bool verbose);
    double* rawPointer(); /* unsupported: skipped with a log line */
    const char* label(const char* prefix);
    char* scratch(char* buffer); /* owned or written memory: skipped */
    const char* title; /* a pointer member is not a property */
    std::vector<int> row(int i);
    std::vector<std::shared_ptr<Matrix>> split(std::vector<std::string> names);
    static void configure(std::string, std::string other);
    std::vector<unsigned char> raw();
private:
    int hidden();
};

class Untouchable {
    int privateByDefault();
public:
    void run();
};

#endif
`;

describe('parseCppSurface', () => {
    const logs = [];
    const model = parseCppSurface(HEADER, (m) => logs.push(m));

    test('finds classes with their public surface only', () => {
        const matrix = model.classes.find((c) => c.name === 'Matrix');
        expect(matrix).toBeTruthy();
        expect(matrix.methods.map((m) => m.name)).toEqual(['get', 'multiple', 'describe', 'label', 'row', 'split', 'configure', 'raw']);
        const untouchable = model.classes.find((c) => c.name === 'Untouchable');
        expect(untouchable.methods.map((m) => m.name)).toEqual(['run']);
    });

    test('parses the constructor with its arguments', () => {
        const matrix = model.classes.find((c) => c.name === 'Matrix');
        expect(matrix.ctor.args).toEqual([
            { name: 'size', type: 'number' },
            { name: 'initValue', type: 'number' },
        ]);
    });

    test('maps primitives, strings and shared_ptr', () => {
        const matrix = model.classes.find((c) => c.name === 'Matrix');
        const multiple = matrix.methods.find((m) => m.name === 'multiple');
        expect(multiple.ret).toBe('Matrix | null');
        expect(multiple.args[0].type).toBe('Matrix');
        const describeFn = matrix.methods.find((m) => m.name === 'describe');
        expect(describeFn.isStatic).toBe(true);
        expect(describeFn.ret).toBe('string');
        expect(describeFn.args.map((a) => a.type)).toEqual(['string', 'boolean']);
    });

    test('maps vectors to CppVector and shared_ptr returns to nullable', () => {
        const matrix = model.classes.find((c) => c.name === 'Matrix');
        expect(matrix.methods.find((m) => m.name === 'multiple').ret).toBe('Matrix | null');
        expect(matrix.methods.find((m) => m.name === 'row').ret).toBe('CppVector<number>');
        const split = matrix.methods.find((m) => m.name === 'split');
        expect(split.ret).toBe('CppVector<Matrix>');
        expect(split.args[0].type).toBe('CppVector<string>');
    });

    test('handles unnamed parameters and unsigned char vectors', () => {
        const matrix = model.classes.find((c) => c.name === 'Matrix');
        const configure = matrix.methods.find((m) => m.name === 'configure');
        expect(configure.args).toEqual([
            { name: 'arg0', type: 'string' },
            { name: 'other', type: 'string' },
        ]);
        expect(matrix.methods.find((m) => m.name === 'raw').ret).toBe('CppVector<number>');
    });

    test('skips unsupported members with a log line instead of failing', () => {
        const matrix = model.classes.find((c) => c.name === 'Matrix');
        expect(matrix.methods.find((m) => m.name === 'rawPointer')).toBeUndefined();
        expect(logs.some((l) => l.includes('rawPointer'))).toBe(true);
    });

    test('types a const char pointer as a string and keeps other char pointers unsupported', () => {
        const matrix = model.classes.find((c) => c.name === 'Matrix');
        const label = matrix.methods.find((m) => m.name === 'label');
        expect(label.args).toEqual([{ name: 'prefix', type: 'string' }]);
        expect(label.ret).toBe('string | null');
        expect(matrix.methods.find((m) => m.name === 'scratch')).toBeUndefined();
        expect(logs.some((l) => l.includes('scratch'))).toBe(true);
        expect(matrix.fields.find((f) => f.name === 'title')).toBeUndefined();
    });
});

describe('emitCppDts', () => {
    test('emits typed classes, any-fallbacks for unparsed exports, and the module tail', () => {
        const model = parseCppSurface(HEADER, () => {});
        const dts = emitCppDts(model, ['Matrix', 'Untouchable', 'VectorMatrix']);
        expect(dts).toContain('export declare class Matrix {');
        expect(dts).toContain('constructor(size: number, initValue: number);');
        expect(dts).toContain('multiple(b: Matrix): Matrix | null;');
        expect(dts).toContain('export interface CppVector<T> {');
        expect(dts).toContain('row(i: number): CppVector<number>;');
        expect(dts).toContain('static describe(name: string, verbose: boolean): string;');
        expect(dts).toContain('export declare const VectorMatrix: any;');
        expect(dts).toContain('export declare function initNative');
        expect(dts).not.toContain('rawPointer');
        const matrixBlock = dts.slice(dts.indexOf('export declare class Matrix'));
        expect(matrixBlock).not.toContain('delete()');
    });

    test('promise mode wraps method returns but never constructors', () => {
        const model = parseCppSurface(HEADER, () => {});
        const dts = emitCppDts(model, ['Matrix'], 'promise');
        expect(dts).toContain('constructor(size: number, initValue: number);');
        expect(dts).toContain('multiple(b: Matrix): Promise<Matrix | null>;');
        expect(dts).toContain('get(index: number): Promise<T>;');
        expect(dts).toContain('static describe(name: string, verbose: boolean): Promise<string>;');
        expect(dts).not.toContain('Promise<Promise');
    });

    test('emits only exported classes and keeps names verbatim', () => {
        const model = parseCppSurface(HEADER, () => {});
        const dts = emitCppDts(model, ['Matrix']);
        expect(dts).not.toContain('Untouchable');
        expect(dts).toContain('get(i: number): number;');
    });

    test('omits the CppVector interface when no vector crosses the surface', () => {
        const dts = emitCppDts(parseCppSurface('class P { public: int id(); };', () => {}), ['P']);
        expect(dts).not.toContain('CppVector');
    });
});
