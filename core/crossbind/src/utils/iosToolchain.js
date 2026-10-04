// The Xcode every iOS archive is built with, and the deployment target it is built for: port archives
// and Conan packages link into the same app, so they move together.
export const IOS_DEVELOPER_DIR = '/Applications/Xcode.app/Contents/Developer';
// Xcode 27 refuses deployment targets below 15.0; React Native's own floor is 15.1.
export const IOS_DEPLOYMENT_TARGET = '15.1';
