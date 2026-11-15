// The android image's NDK, and the API level every Android archive is built against: port archives
// and Conan packages link into the same library, so they move together.
export const ANDROID_NDK = '/opt/android-sdk/ndk/current';
export const ANDROID_API_LEVEL = 33;
// The C++ runtime every Android library links. The NDK's default links libc++ into each library, which then exports it:
// an app of several would run as many runtimes, and Android compares type_info by address. One libc++_shared.so, which
// the app ships, serves them all.
export const ANDROID_STL = 'c++_shared';
