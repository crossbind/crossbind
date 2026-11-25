// The NDK crossbind's android image builds with (tooling/docker/android.Dockerfile's NDK_VERSION). The libraries an app
// links from crossbind need its libc++_shared.so or a newer one, and an app ships the one of the NDK it builds with.
module.exports = '30.0.16248370';
