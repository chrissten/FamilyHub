const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

// The tablet app reuses the phone app's API client, types, theme and calendar maths
// straight from ../mobile/src rather than copying them.
const sharedDir = path.resolve(__dirname, '../mobile/src');

const config = getDefaultConfig(__dirname);
config.watchFolders = [sharedDir];

// Bare imports inside the shared files (react, expo-secure-store, ...) would otherwise
// resolve against mobile/node_modules and load a second copy of React. Resolve them as
// if they were imported from this project instead.
const anchor = path.join(__dirname, 'package.json');
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (context.originModulePath.startsWith(sharedDir) && !moduleName.startsWith('.')) {
    return context.resolveRequest({ ...context, originModulePath: anchor }, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
