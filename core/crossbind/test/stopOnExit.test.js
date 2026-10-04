import { describe, test, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import stopOnExit from '../../embind-napi/js/stopOnExit.js';

describe('stopOnExit', () => {
    test('keeps one exit listener for the addons of every package', () => {
        const proc = new EventEmitter();

        Array.from({ length: 12 }, () => stopOnExit(() => {}, proc));

        expect(proc.listenerCount('exit')).toBe(1);
    });

    // An exit handler registered before a package boots may still call that package's addon.
    test('stops each addon after the exit handlers registered before it booted', () => {
        const proc = new EventEmitter();
        const order = [];
        proc.on('exit', () => order.push('handler before zlib'));
        stopOnExit(() => order.push('stop zlib'), proc);
        proc.on('exit', () => order.push('handler before gdal'));
        stopOnExit(() => order.push('stop gdal'), proc);

        proc.emit('exit');

        expect(order).toEqual(['handler before zlib', 'handler before gdal', 'stop zlib', 'stop gdal']);
    });
});
