import { initNative, Version, VersionReq } from 'cargo:semver';

await initNative();

const wanted = await VersionReq.parse('^1.2');
for (const text of ['1.1.0', '1.4.2', '2.0.0']) {
    const version = await Version.parse(text);
    console.log(text, await wanted.matches(version));
}
