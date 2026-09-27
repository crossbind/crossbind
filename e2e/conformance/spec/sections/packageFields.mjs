import { rejecting } from './expect.mjs';

// Fields of C structs in a package's own headers, bridged when a bundler imports the header (zlib.h's z_stream,
// webp's encode.h as the ports ship them): numbers, enums as their integer, pointers as handles, and a pointer to a
// struct the same header binds as an instance.
export function packageFieldChecks({ add }, { zlib, webp }, { worker }) {
    const rejects = rejecting(add);
    const bytes = async (text) => {
        const buffer = await zlib.allocBuffer(text.length);
        await zlib.writeBytes(buffer, text);
        return buffer;
    };
    // deflateInit2 and inflateInit2 are macros passing sizeof(z_stream): 56 bytes on wasm32, 112 on 64-bit targets.
    const open = async (init, ...args) => {
        const stream = await new zlib.z_stream();
        const version = await zlib.zlibVersion();
        for (const size of [56, 112]) {
            if ((await init(stream, ...args, version, size)) === 0) return stream;
        }
        throw new Error('z_stream is neither 56 nor 112 bytes');
    };
    // Worker legs write fields over the object's own port and call over the module's: the read-back orders them.
    const connect = async (stream, input, inputSize, output, outputSize) => {
        stream.next_in = input;
        stream.avail_in = inputSize;
        stream.next_out = output;
        stream.avail_out = outputSize;
        await stream.avail_out;
    };
    const text = 'crossbind fields '.repeat(40);

    add('pkgField:pointerRoundTrip', async () => {
        const capacity = text.length + 64;
        const packer = await open(zlib.deflateInit2_, 9, 8, 15, 8, 0);
        const packed = await zlib.allocBuffer(capacity);
        await connect(packer, await bytes(text), text.length, packed, capacity);
        const finished = await zlib.deflate(packer, 4);
        const size = capacity - (await packer.avail_out);
        await zlib.deflateEnd(packer);
        const unpacker = await open(zlib.inflateInit2_, 15);
        const copy = await zlib.allocBuffer(text.length);
        await connect(unpacker, packed, size, copy, text.length);
        const ended = await zlib.inflate(unpacker, 0);
        const back = await zlib.readBytes(copy, text.length - (await unpacker.avail_out));
        await zlib.inflateEnd(unpacker);
        return [finished, ended, size > 0 && size < text.length, back === text];
    }, [1, 1, true, true]);
    // The port's zlib 1.3.2 is the one that runs, not a device's older copy: compressBound_z is new in 1.3.2.
    add('pkgField:portZlib', async () => [
        await zlib.zlibVersion(),
        Number(await zlib.compressBound_z(100)) === Number(await zlib.compressBound(100)),
    ], ['1.3.2', true]);
    add('pkgField:unsignedLong', async () => {
        const stream = await open(zlib.deflateInit2_, 9, 8, 15, 8, 0);
        await connect(stream, await bytes('abc'), 3, await zlib.allocBuffer(64), 64);
        await zlib.deflate(stream, 4);
        const [totalIn, totalOut, left] = [Number(await stream.total_in), Number(await stream.total_out), await stream.avail_out];
        await zlib.deflateEnd(stream);
        return [totalIn, totalOut === 64 - left];
    }, [3, true]);
    add('pkgField:charPointer', async () => {
        const stream = await open(zlib.inflateInit2_, 15);
        await connect(stream, await bytes('not zlib'), 8, await zlib.allocBuffer(16), 16);
        const status = await zlib.inflate(stream, 0);
        const message = await zlib.readCString(await stream.msg);
        await zlib.inflateEnd(stream);
        return [status, message];
    }, [-3, 'incorrect header check']);
    add('pkgField:pointerTypedef', async () => {
        const stream = await new zlib.z_stream();
        const before = await stream.opaque;
        stream.opaque = await zlib.allocBuffer(4);
        const set = (await stream.opaque) !== null;
        stream.opaque = null;
        return [before, set, await stream.opaque];
    }, [null, true, null]);
    add('pkgField:enum', async () => {
        const config = await new webp.WebPConfig();
        await webp.WebPConfigPreset(config, await webp.WebPPreset.WEBP_PRESET_PHOTO, 75);
        const hint = await config.image_hint;
        const sns = await config.sns_strength;
        config.image_hint = 3;
        return [hint, sns, await config.image_hint, await webp.WebPValidateConfig(config)];
    }, [0, 80, 3, 1]);
    add('pkgField:enumMember', async () => {
        const config = await new webp.WebPConfig();
        config.image_hint = await webp.WebPImageHint.WEBP_HINT_PHOTO;
        return config.image_hint;
    }, 2);
    // An enum parameter takes the member's number as well: 2 is WEBP_PRESET_PHOTO, whose filter sharpness is 3.
    add('pkgField:enumNumberParam', async () => {
        const config = await new webp.WebPConfig();
        await webp.WebPConfigPreset(config, 2, 75);
        return [await config.sns_strength, await config.filter_sharpness];
    }, [80, 3]);
    add('pkgField:pointerWrittenByC', async () => {
        const picture = await new webp.WebPPicture();
        await webp.WebPPictureInit(picture);
        picture.use_argb = 1;
        picture.width = 4;
        picture.height = 3;
        await picture.height;
        const before = await picture.argb;
        const allocated = await webp.WebPPictureAlloc(picture);
        const written = (await picture.argb) !== null;
        const stride = await picture.argb_stride;
        await webp.WebPPictureFree(picture);
        return [before, allocated, written, stride, await picture.argb];
    }, [null, 1, true, 4, null]);
    add('pkgField:instance', async () => {
        const picture = await new webp.WebPPicture();
        const stats = await new webp.WebPAuxStats();
        stats.coded_size = 7;
        await stats.coded_size;
        picture.stats = stats;
        const view = await picture.stats;
        const read = await view.coded_size;
        view.coded_size = 9;
        await view.coded_size;
        const shared = await stats.coded_size;
        await view.delete();
        const kept = await stats.coded_size;
        picture.stats = null;
        return [read, shared, kept, await picture.stats];
    }, [7, 9, 9, null]);
    // A write a worker proxy rejects surfaces only as an unhandled rejection, so these run on direct runtimes.
    if (!worker) {
        rejects('pkgField:pointerRejects', async () => {
            const stream = await new zlib.z_stream();
            stream.next_in = 'text';
        }, /NativePointer/);
        rejects('pkgField:enumRejects', async () => {
            const config = await new webp.WebPConfig();
            config.image_hint = 'graph';
        }, /number|enum|convert/i);
    }
}
