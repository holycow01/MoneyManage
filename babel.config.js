module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
    // Worklets plugin (used by Reanimated v4) — must be the last plugin.
    plugins: ["react-native-worklets/plugin"],
  };
};
