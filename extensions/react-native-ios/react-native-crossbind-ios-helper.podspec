require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))
#folly_compiler_flags = '-DFOLLY_NO_CONFIG -DFOLLY_MOBILE=1 -DFOLLY_USE_LIBCPP=1 -Wno-comma -Wno-shorten-64-to-32'

Pod::Spec.new do |s|
  s.name         = "react-native-crossbind-ios-helper"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = "crossbind Authors"

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :http => "https://crossbind.dev" }
  s.source_files = "ios/**/*.{h,hpp,c,cpp,m,mm}"

  if respond_to?(:install_modules_dependencies, true)
    install_modules_dependencies(s)
  else
    s.dependency "React-Core"
  end
end
