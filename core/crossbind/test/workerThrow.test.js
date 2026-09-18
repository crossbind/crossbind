import { describe, test, expect } from 'vitest';
import * as Comlink from 'comlink';
import '../src/assets/js-runtime/adapters/worker-comlink.js';

const handler = () => Comlink.transferHandlers.get('throw');

describe('worker throw transfer handler', () => {
    test('carries the error properties a binding attached, and drops what cannot be cloned', () => {
        const error = Object.assign(new Error('coded failure'), {
            code: 'E_CONF', status: 7, retriable: false, cause: null, hint: () => 'no',
        });

        const [serialized] = handler().serialize({ value: error });

        expect(serialized.isError).toBe(true);
        expect(serialized.value.message).toBe('coded failure');
        expect(serialized.value.code).toBe('E_CONF');
        expect(serialized.value.status).toBe(7);
        expect(serialized.value.retriable).toBe(false);
        expect(serialized.value.cause).toBe(null);
        expect('hint' in serialized.value).toBe(false);
        expect(() => structuredClone(serialized)).not.toThrow();
    });

    test('deserialize throws an Error that still carries the code', () => {
        const [serialized] = handler().serialize({ value: Object.assign(new Error('boom'), { code: 'E_X' }) });

        try {
            handler().deserialize(serialized);
            expect.unreachable('deserialize must rethrow');
        } catch (e) {
            expect(e).toBeInstanceOf(Error);
            expect(e.message).toBe('boom');
            expect(e.code).toBe('E_X');
        }
    });

    test('a non-Error rejection value passes through untouched', () => {
        const [serialized] = handler().serialize({ value: { reason: 'plain' } });

        expect(serialized.isError).toBe(false);
        expect(serialized.value).toEqual({ reason: 'plain' });
    });
});
