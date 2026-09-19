/**
 * Expo config plugin shipped by @crossbind/plugin-react-native.
 *
 * crossbind ships arm64-only iOS simulator slices for its xcframeworks
 * (react-native-crossbind, @crossbind/example-lib-prebuilt-matrix, the @crossbind/port-*
 * family, ...). A Release build compiles every architecture
 * (ONLY_ACTIVE_ARCH=NO), so the simulator build otherwise tries x86_64 and fails
 * with `ld: library '...' not found` because there is no matching x86_64 slice.
 *
 * `expo prebuild` regenerates ios/ from scratch, so the exclusion can't live in
 * a committed Podfile/pbxproj — it must be injected at prebuild time. Add
 * "@crossbind/plugin-react-native" to the `plugins` array of your app config and
 * this drops x86_64 from every Pod target and the app target, and raises any pod
 * left on CocoaPods' 9.0 default to the deployment target crossbind builds for.
 *
 * NOTE: .cjs because the package is `"type": "module"`; Expo resolves
 * app.plugin.{js,cjs,mjs,...} and a config plugin must be CommonJS-loadable.
 */

const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod, createRunOncePlugin } = require('@expo/config-plugins');
const { mergeContents } = require('@expo/config-plugins/build/utils/generateCode');

const pkg = require('./package.json');

const SETTING = 'EXCLUDED_ARCHS[sdk=iphonesimulator*]';
// crossbind compiles its own iOS artifacts for this floor, and Xcode 27 refuses to build a target
// below 15.0 at all. A pod that declares no platform inherits CocoaPods' 9.0 default (SDWebImage's
// resource bundle does), which fails the whole build, so every pod target is raised to the floor.
const DEPLOYMENT_TARGET = '15.1';

const POST_INSTALL_SNIPPET = [
    '    installer.pods_project.targets.each do |target|',
    '      target.build_configurations.each do |config|',
    `        config.build_settings['${SETTING}'] = 'x86_64'`,
    `        if config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'].to_f < ${DEPLOYMENT_TARGET}`,
    `          config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${DEPLOYMENT_TARGET}'`,
    '        end',
    '      end',
    '    end',
    '    installer.aggregate_targets.each do |aggregate_target|',
    '      aggregate_target.user_project.native_targets.each do |target|',
    '        target.build_configurations.each do |config|',
    `          config.build_settings['${SETTING}'] = 'x86_64'`,
    '        end',
    '      end',
    '      aggregate_target.user_project.save',
    '    end',
].join('\n');

function withExcludeSimulatorArchs(config) {
    return withDangerousMod(config, ['ios', (cfg) => {
        const podfile = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
        const before = fs.readFileSync(podfile, 'utf8');
        const merged = mergeContents({
            tag: 'crossbind-exclude-simulator-x86_64',
            src: before,
            newSrc: POST_INSTALL_SNIPPET,
            anchor: /post_install do \|installer\|/,
            offset: 1,
            comment: '#',
        });
        if (merged.didMerge) {
            fs.writeFileSync(podfile, merged.contents);
        }
        return cfg;
    }]);
}

module.exports = createRunOncePlugin(withExcludeSimulatorArchs, pkg.name, pkg.version);
