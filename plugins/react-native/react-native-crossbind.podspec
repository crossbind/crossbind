require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))
system("cd \"#{Pod::Config.instance.installation_root}/..\" && node \"#{__dir__}/script/build_js.js\" ios && node \"#{__dir__}/script/build_ios.js\" Debug", :out => File::NULL)

Pod::Spec.new do |s|
  s.name         = "react-native-crossbind"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = "crossbind Authors"

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :http => "https://crossbind.dev" }

  # conan/ holds the app's Conan libraries, which build_ios.js copies there. CocoaPods links what it
  # finds at pod install, so a changed conanDependencies needs another pod install.
  s.vendored_frameworks = ['react-native-crossbind.xcframework', 'conan/*.xcframework']

  s.script_phase = {
    :name => 'crossbind',
    # The Pods `[CP] Copy XCFrameworks` phase extracts the vendored xcframework slice into
    # PODS_XCFRAMEWORKS_BUILD_DIR before this script runs, so even though build_ios.js
    # rebuilds the xcframework with the user's bridge symbols, the linker would still see
    # the stale extracted .a unless we overwrite it here. The same goes for a Conan archive that a new
    # package version restaged.
    :script => 'set -e
cd "${PODS_ROOT}/../.."
node "${PODS_TARGET_SRCROOT}/script/build_js.js" ios
node "${PODS_TARGET_SRCROOT}/script/build_ios.js" "${CONFIGURATION}"
case "${PLATFORM_NAME}" in
  iphonesimulator) SLICE="ios-arm64-simulator" ;;
  *) SLICE="ios-arm64" ;;
esac
SRC="${PODS_TARGET_SRCROOT}/react-native-crossbind.xcframework/${SLICE}/libreact-native-crossbind.a"
DST="${PODS_XCFRAMEWORKS_BUILD_DIR}/react-native-crossbind/libreact-native-crossbind.a"
if [ -f "${SRC}" ]; then
  mkdir -p "$(dirname "${DST}")"
  cp -f "${SRC}" "${DST}"
fi
for XC in "${PODS_TARGET_SRCROOT}"/conan/*.xcframework; do
  if [ -d "${XC}/${SLICE}" ]; then
    mkdir -p "$(dirname "${DST}")"
    cp -f "${XC}/${SLICE}"/*.a "$(dirname "${DST}")/"
  fi
done',
    :execution_position => :before_compile,
    :output_files => ['$(PODS_XCFRAMEWORKS_BUILD_DIR)/react-native-crossbind/libreact-native-crossbind.a']
  }
  # crossbind xcframework slices ship arm64 only for iOS simulator. Apple
  # Silicon Macs always build for arm64, but Release configs default to
  # ONLY_ACTIVE_ARCH=NO and would otherwise also try to link x86_64, which
  # has no matching slice. Drop x86_64 explicitly so consumer apps (clean
  # React Native installs included) don't have to patch their pbxproj.
  s.user_target_xcconfig = {
    'OTHER_LDFLAGS' => '-ObjC -force_load $(PODS_XCFRAMEWORKS_BUILD_DIR)/react-native-crossbind/libreact-native-crossbind.a',
    'EXCLUDED_ARCHS[sdk=iphonesimulator*]' => 'x86_64'
  }
end
