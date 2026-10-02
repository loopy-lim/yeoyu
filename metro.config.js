const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");
const path = require("path");
const fs = require("fs");
const { withUniwindConfig } = require("uniwind/metro");
const uniwindRoot = path.dirname(require.resolve("uniwind/package.json"));
const contains = (root, file) => {
  const relative = path.relative(root, file);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};
const config = mergeConfig(getDefaultConfig(__dirname), {
  watchFolders: [path.resolve(__dirname, ".deps/rustra-main/packages")],
  resolver: {
    nodeModulesPaths: [path.resolve(__dirname, "node_modules")],
    blockList: [/[/\\](target|build|\.gradle|\.cxx)[/\\]/],
    resolveRequest(context, name, platform) {
      const origin = context.originModulePath;
      // The installed compiler has its own @/ sources; keep that namespace
      // separate from application modules, including during offline tests.
      if (name.startsWith("@/") && contains(uniwindRoot, origin))
        return context.resolveRequest(
          context,
          path.join(uniwindRoot, "src", name.slice(2)),
          platform
        );
      if (
        contains(__dirname, origin) &&
        !origin.includes(`${path.sep}node_modules${path.sep}`) &&
        !contains(path.join(__dirname, ".deps"), origin)
      ) {
        const target =
          name === "@styles/global.css"
            ? path.join(__dirname, "global.css")
            : name.startsWith("@/")
            ? path.join(__dirname, "src", name.slice(2))
            : name.startsWith("@modules/")
            ? path.join(__dirname, "modules", name.slice(9))
            : name.startsWith("@generated/")
            ? path.join(__dirname, "generated", name.slice(11))
            : null;
        if (target) return context.resolveRequest(context, target, platform);
      }
      if (name === "@rustra/types")
        return context.resolveRequest(
          context,
          path.resolve(
            __dirname,
            ".deps/rustra-main/packages/types/dist/index.js"
          ),
          platform
        );
      // Rustra emits ESM .js specifiers; the consumer bundles the generated .ts sources.
      if (
        context.originModulePath.startsWith(
          path.join(__dirname, "generated")
        ) &&
        name.startsWith(".") &&
        name.endsWith(".js")
      ) {
        const ts = name.slice(0, -3) + ".ts";
        if (
          fs.existsSync(
            path.resolve(path.dirname(context.originModulePath), ts)
          )
        )
          return context.resolveRequest(context, ts, platform);
      }
      return context.resolveRequest(context, name, platform);
    },
  },
});
module.exports = withUniwindConfig(config, {
  cssEntryFile: "./global.css",
  dtsFile: "./src/uniwind-types.d.ts",
});
