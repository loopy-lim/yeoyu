const fs = require("node:fs");
const path = require("node:path");
const { transformSync } = require("@babel/core");
const rnRoot = path.dirname(require.resolve("react-native/package.json"));
// Load the installed RN algorithms unchanged. Only native boundary dependencies
// are substituted; no Pressability timer, state transition, or React hook is mocked.
const substitutes = {
  "../../src/private/featureflags/ReactNativeFeatureFlags": {
    shouldPressibilityUseW3CPointerEventsForHover: () => false,
  },
  "../Components/Sound/SoundManager": { playTouchSound() {} },
  "../ReactNative/UIManager": {
    measure(_id, callback) {
      callback(0, 0, 100, 100, 0, 0);
    },
  },
  "../StyleSheet/Rect": { normalizeRect: (value) => value },
  "../Utilities/Platform": { OS: "android" },
  "./HoverState": { isHoverEnabled: () => false },
  "./PressabilityPerformanceEventEmitter.js": { emitEvent() {} },
};
function load(name, extra = {}) {
  const filename = name.startsWith("/")
    ? name
    : path.join(rnRoot, "Libraries/Pressability", name + ".js");
  const code = transformSync(fs.readFileSync(filename, "utf8"), {
    filename,
    babelrc: false,
    configFile: false,
    presets: [require.resolve("@react-native/babel-preset")],
  }).code;
  const module = { exports: {} };
  const localRequire = (name) =>
    name in extra
      ? extra[name]
      : name in substitutes
      ? substitutes[name]
      : require(name);
  new Function("require", "module", "exports", "__DEV__", code)(
    localRequire,
    module,
    module.exports,
    false
  );
  return module.exports.default;
}
const Pressability = load("Pressability");
const usePressability = load("usePressability", {
  "./Pressability": Pressability,
});
const Pressable = load(
  path.join(rnRoot, "Libraries/Components/Pressable/Pressable.js"),
  {
    "../../Pressability/usePressability": usePressability,
    "../../Pressability/PressabilityDebug": {
      PressabilityDebugView: () => null,
    },
    "../../Utilities/useMergeRefs": (...refs) =>
      require("react").useMemo(
        () => (value) => {
          for (const ref of refs) {
            if (typeof ref === "function") ref(value);
            else if (ref) ref.current = value;
          }
        },
        refs
      ),
    "../View/View": "View",
    "./useAndroidRippleForView": () => null,
  }
);
module.exports = { Pressability, usePressability, Pressable };

// Execute the exact current App IconButton, substituting only theme/host seams.
module.exports.loadAppIconButton = (bindings) => {
  const filename = path.resolve(__dirname, "../../src/App.tsx");
  const app = fs.readFileSync(filename, "utf8");
  const start = app.indexOf("const IconButton =");
  const end = app.indexOf("const NewTabPage =", start);
  if (start < 0 || end < 0) throw new Error("App IconButton boundary changed");
  const code = transformSync(app.slice(start, end), {
    filename,
    babelrc: false,
    configFile: false,
    presets: [require.resolve("@react-native/babel-preset")],
  }).code;
  return new Function(
    "require",
    ...Object.keys(bindings),
    code + "\nreturn IconButton;"
  )(require, ...Object.values(bindings));
};
module.exports.loadAppDropHandlers = (bindings) => {
  const filename = path.resolve(__dirname, "../../src/App.tsx");
  const app = fs.readFileSync(filename, "utf8");
  const slice = (from, to) => {
    const start = app.indexOf(from),
      end = app.indexOf(to, start);
    if (start < 0 || end < 0)
      throw new Error("App drop boundary changed: " + from);
    return app.slice(start, end);
  };
  const clear = app.includes("  const clearSidebarDropBounds =")
    ? slice("  const clearSidebarDropBounds =", "  const measurePanes =")
    : "";
  const fragment =
    clear +
    slice("  const measurePanes =", "  // Drag ghost follows") +
    slice("  const renderDrag =", "  const cancelDrag =");
  const code = transformSync(fragment, {
    filename,
    babelrc: false,
    configFile: false,
    presets: [require.resolve("@react-native/babel-preset")],
  }).code;
  return new Function(
    ...Object.keys(bindings),
    code + "\nreturn {measurePanes,moveDrag,finishDrag};"
  )(...Object.values(bindings));
};
