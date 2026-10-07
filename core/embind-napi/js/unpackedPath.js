// Native code cannot read inside an Electron asar archive, so a packaged app keeps what an addon
// reads in <archive>.asar.unpacked beside it.
export default function unpackedPath(file, isElectron = Boolean(process.versions.electron)) {
    return isElectron ? file.replace(/\.asar(?=[\\/]|$)/, '.asar.unpacked') : file;
}
