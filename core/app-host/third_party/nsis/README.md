# NSIS (license only)

A Windows app's setup program, which makensis builds in crossbind's windows image (Debian's `nsis` 3.11,
`tooling/docker/windows.Dockerfile`) from crossbind's `src/installers/nsis/installer.nsi`, carries NSIS's installer
stub and the plugins its pages call. This folder keeps their license, which `crossbind licenses` quotes.

- Upstream: https://nsis.sourceforge.io
- Version: `3.11`, Debian's `nsis` and `nsis-common` `3.11-1`
- License: `LICENSE` holds the zlib/libpng license from the release's `COPYING`, and the MIT license of the System
  plugin's `Contrib/System/Source/Call.S`, from that file. The setup program compresses with zlib, so it carries none
  of NSIS's bzip2 and LZMA modules, whose `COPYING` sections are left out.
