import fs from 'node:fs';
import path from 'node:path';
import run from './run.js';
import state from '../state/index.js';
import toolchainNoticesDir, { WASM_NOTICES } from '../utils/toolchainNotices.js';
import { getDockerImage, imageRoleFor } from '../utils/pullDockerImage.js';

const IMAGE_LICENSES = '/opt/licenses';
const EMSDK_UPSTREAM = '/emsdk/upstream';

const imageFile = () => path.join(state.config.paths.build, toolchainNoticesDir('wasm'), WASM_NOTICES.image);

export const hasWasmNotices = () => fs.existsSync(imageFile());

// A wasm module links Emscripten's libraries and LLVM's C++ runtime. The web image keeps their license texts, and its emsdk
// their versions: a link copies them beside the build once for each image, and crossbind licenses lists them from there.
export default function copyWasmNotices(target) {
    const image = getDockerImage(imageRoleFor(target));
    if (hasWasmNotices() && fs.readFileSync(imageFile(), 'utf8') === image) return;
    const notices = toolchainNoticesDir('wasm');
    const copy = (from, file) => `if [ -f ${from} ]; then cp ${from} ${notices}/${file}; fi`;
    // run(null, …) on wasm wraps a configure or a make in emscripten's own: sh is named.
    run('sh', ['-c', [
        `mkdir -p ${notices}`,
        copy(`${IMAGE_LICENSES}/emscripten-LICENSE`, WASM_NOTICES.emscriptenText),
        copy(`${IMAGE_LICENSES}/llvm-LICENSE.TXT`, WASM_NOTICES.llvmText),
        copy(`${EMSDK_UPSTREAM}/emscripten/emscripten-version.txt`, WASM_NOTICES.emscriptenVersion),
        `if [ -x ${EMSDK_UPSTREAM}/bin/clang ]; then ${EMSDK_UPSTREAM}/bin/clang --version > ${notices}/${WASM_NOTICES.llvmVersion}; fi`,
    ].join('; ')], null, target);
    fs.mkdirSync(path.dirname(imageFile()), { recursive: true });
    fs.writeFileSync(imageFile(), image);
}
