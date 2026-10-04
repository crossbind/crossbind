// The tools xcode-select picks, behind /usr/bin's shims, which the Command Line Tools alone also provide,
// and the macOS every macOS archive is built for: port archives and Conan packages link into the same
// addon, so they move together.
export const DARWIN_TOOLS_BIN = '/usr/bin';
export const DARWIN_CC = `${DARWIN_TOOLS_BIN}/clang`;
export const DARWIN_CXX = `${DARWIN_TOOLS_BIN}/clang++`;
// Node 22, the oldest supported line, needs macOS 11.
export const DARWIN_DEPLOYMENT_TARGET = '11.0';
// Homebrew and MacPorts packages exist on the build machine only: an archive compiled against one fails
// to link, or to load, anywhere else.
export const DARWIN_HOST_PACKAGE_PREFIXES = ['/opt/homebrew', '/usr/local', '/opt/local'];
