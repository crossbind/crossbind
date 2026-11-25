# @crossbind/extension-react-native-ios

The iOS pod of crossbind's React Native extension: the module that installs crossbind's bindings in the app's JavaScript
runtime.

## Install

A React Native app installs it beside `@crossbind/extension-react-native`, as React Native's autolinking reads the
app's own dependencies:

```sh
npm install @crossbind/extension-react-native @crossbind/extension-react-native-ios
```

## Why a package of its own

The React Native extension's pod links the library crossbind builds for the app, which takes the pod's name, and a pod
that compiled this module as well would make a second library of that name, which CocoaPods refuses.
