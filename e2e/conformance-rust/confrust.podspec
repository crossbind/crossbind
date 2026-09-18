require "json"
package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.module_name  = "confrust"
  s.name         = "confrust"
  s.version      = package["nativeVersion"]
  s.summary      = "confrust package"
  s.homepage     = "https://crossbind.dev"
  s.author       = "confrust Authors"
  s.source       = { :http => "https://crossbind.dev" }
  s.vendored_frameworks = 'confrust.xcframework'
  s.resources = []
  # arm64-only iOS simulator slice; drop x86_64 to avoid linker errors on consumer apps.
  # Cargo producers add a -force_load so their init-array constructors survive dead-strip.
  s.user_target_xcconfig = { 'EXCLUDED_ARCHS[sdk=iphonesimulator*]' => 'x86_64', 'OTHER_LDFLAGS' => '-Wl,-u,_crossbind_keep_confrust' }
end
