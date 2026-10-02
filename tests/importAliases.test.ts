import { expect, test } from "bun:test";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { resolve, type CustomResolutionContext } from "metro-resolver";

const projectRoot = path.resolve(import.meta.dir, "..");
const require = createRequire(import.meta.url);
const config = require("../metro.config.js");

function metroModule(specifier: string, origin = "src/App.tsx") {
  const context: CustomResolutionContext = {
    originModulePath: path.resolve(projectRoot, origin),
    resolveRequest: resolve,
    allowHaste: false,
    assetExts: new Set(config.resolver.assetExts),
    customResolverOptions: {},
    disableHierarchicalLookup: false,
    doesFileExist: (file) => existsSync(file) && statSync(file).isFile(),
    fileSystemLookup: (file) => {
      if (!existsSync(file)) return { exists: false };
      return {
        exists: true,
        type: statSync(file).isDirectory() ? "d" : "f",
        realPath: realpathSync(file),
      };
    },
    extraNodeModules: undefined,
    dev: true,
    getPackage: (file) =>
      existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null,
    getPackageForModule: () => null,
    mainFields: config.resolver.resolverMainFields,
    nodeModulesPaths: config.resolver.nodeModulesPaths,
    preferNativePlatform: true,
    resolveAsset: () => null,
    redirectModulePath: (module) => module,
    resolveHasteModule: () => null,
    resolveHastePackage: () => null,
    sourceExts: config.resolver.sourceExts,
    unstable_conditionNames: config.resolver.unstable_conditionNames,
    unstable_conditionsByPlatform:
      config.resolver.unstable_conditionsByPlatform,
    unstable_enablePackageExports: true,
    unstable_incrementalResolution: false,
    unstable_logWarning: () => {},
  };
  return config.resolver.resolveRequest(context, specifier, "android");
}

test("app aliases resolve to the same source files in Bun and native Metro", () => {
  for (const [specifier, file] of [
    ["@/ui/cn", "src/ui/cn.ts"],
    [
      "@modules/browser-surface/src/BrowserSurfaceNativeComponent",
      "modules/browser-surface/src/BrowserSurfaceNativeComponent.ts",
    ],
    ["@generated/types", "generated/types.ts"],
    ["@styles/global.css", "global.css"],
  ]) {
    const filePath = path.join(projectRoot, file!);
    expect(
      Bun.resolveSync(specifier!, path.join(projectRoot, "src/App.tsx"))
    ).toBe(filePath);
    expect(metroModule(specifier!)).toEqual({ type: "sourceFile", filePath });
  }
});

test("app aliases preserve Uniwind internal sources and Rustra generated specifiers", () => {
  expect(
    metroModule("@/common/consts", "node_modules/uniwind/src/bundler/config.ts")
  ).toEqual({
    type: "sourceFile",
    filePath: path.join(
      projectRoot,
      "node_modules/uniwind/src/common/consts.ts"
    ),
  });
  expect(metroModule("./contract.js", "generated/react-native.ts")).toEqual({
    type: "sourceFile",
    filePath: path.join(projectRoot, "generated/contract.ts"),
  });
  expect(metroModule("@rustra/types")).toEqual({
    type: "sourceFile",
    filePath: path.join(
      projectRoot,
      ".deps/rustra-main/packages/types/dist/index.js"
    ),
  });
  expect(() =>
    metroModule("@/ui/cn", "node_modules/react-native/index.js")
  ).toThrow();
});

test("relative test mocks and app aliases share one canonical Bun module", () => {
  const result = Bun.spawnSync(
    [
      process.execPath,
      "-e",
      `
    import {mock} from "bun:test";
    const runtime = {source: "native-test-port"};
    mock.module("./src/platform", () => ({platform: runtime}));
    const alias = await import("@/platform");
    const relative = await import("./src/platform");
    if (alias.platform !== relative.platform || alias.platform !== runtime)
      throw new Error("Alias imports escaped the canonical native test port");
  `,
    ],
    { cwd: projectRoot, stdout: "pipe", stderr: "pipe" }
  );
  expect({ code: result.exitCode, error: result.stderr.toString() }).toEqual({
    code: 0,
    error: "",
  });
});
