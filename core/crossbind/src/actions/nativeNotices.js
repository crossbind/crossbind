import run from './run.js';
import toolchainNoticesDir, { NATIVE_NOTICES } from '../utils/toolchainNotices.js';
import { linuxTriple } from '../utils/linuxToolchain.js';
import { ANDROID_NDK } from '../utils/androidToolchain.js';

const MINGW_NOTICES = '/opt/licenses/llvm-mingw';
const MINGW_CLANG = '/opt/llvm-mingw/bin/clang';
// The x64 and arm64 targets share one mingw-w64 build.
const MINGW_VERSION_HEADER = '/opt/llvm-mingw/x86_64-w64-mingw32/include/_mingw_mac.h';
const LIBCXX_LICENSE = '/opt/licenses/linux-sysroot/libcxx-LICENSE.TXT';
const MUSL_LICENSE = '/opt/licenses/linux-sysroot/musl/musl-COPYRIGHT';
const NDK_CLANG = `${ANDROID_NDK}/toolchains/llvm/prebuilt/linux-x86_64/bin/clang`;

const ifFile = (file, command) => `if [ -f ${file} ]; then ${command}; fi`;
const clangVersion = (clang, dir) => `if [ -x ${clang} ]; then ${clang} --version > ${dir}/${NATIVE_NOTICES.clangVersion}; fi`;

// What each image keeps of the runtimes it links into a binary: their license texts and what tells their versions. An
// Android app's libc++ has its text from @crossbind/core-app-host, as the NDK keeps it only among the toolchain's.
const SCRIPTS = {
    win32: (dir) => [
        `if [ -d ${MINGW_NOTICES} ]; then cp ${MINGW_NOTICES}/COPYING* ${dir}/; fi`,
        ifFile(`${MINGW_NOTICES}/LICENSE.TXT`, `cp ${MINGW_NOTICES}/LICENSE.TXT ${dir}/${NATIVE_NOTICES.llvmText}`),
        clangVersion(MINGW_CLANG, dir),
        ifFile(MINGW_VERSION_HEADER, `grep '#define __MINGW64_VERSION_' ${MINGW_VERSION_HEADER} > ${dir}/${NATIVE_NOTICES.mingwVersion}`),
    ],
    linux: (dir, target) => {
        const config = `/opt/crossbind/sysroots/${linuxTriple(target)}/usr/include/c++/v1/__config`;
        return [
            ifFile(LIBCXX_LICENSE, `cp ${LIBCXX_LICENSE} ${dir}/${NATIVE_NOTICES.llvmText}`),
            ifFile(config, `grep '#  *define _LIBCPP_VERSION ' ${config} > ${dir}/${NATIVE_NOTICES.libcxxVersion}`),
        ];
    },
    android: (dir) => [clangVersion(NDK_CLANG, dir)],
};
// A static musl executable also carries musl's libc, whose notice every musl link keeps. musl records its version only
// in libc, as the one string of version.lo.
SCRIPTS.linuxmusl = (dir, target) => {
    const libc = `/opt/crossbind/sysroots/${linuxTriple(target)}/usr/lib/libc.a`;
    return [
        ...SCRIPTS.linux(dir, target),
        ifFile(MUSL_LICENSE, `cp ${MUSL_LICENSE} ${dir}/${NATIVE_NOTICES.muslText}`),
        ifFile(libc, `ar p ${libc} version.lo | tr -cs '[:print:]' '\\n' | grep -x -E '[0-9]+\\.[0-9]+\\.[0-9]+' > ${dir}/${NATIVE_NOTICES.muslVersion}`),
    ];
};

// Copies them beside the build after a link in the target's image, where crossbind licenses reads them. A host
// toolchain keeps none of these files, and its build goes on without them.
export default function copyNativeNotices(target) {
    const script = SCRIPTS[target.platform];
    if (!script) return;
    const dir = toolchainNoticesDir(target.platform);
    run('sh', ['-c', [`mkdir -p ${dir}`, ...script(dir, target)].join('; ')], null, target);
}
