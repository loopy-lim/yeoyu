import { mock } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Theme } from "../src/theme";

type Variables = Record<string, string | number>;
type Context = {
  scopedTheme: string | null;
  rtl: boolean | null;
  variables: Variables | null;
};
type Engine = {
  compileCSS(config: unknown): Promise<string>;
  UniwindBundlerConfig: {
    fromMetroConfig(config: unknown, platform: string): unknown;
  };
  UniwindStore: {
    vars: Record<string, Record<string, (vars: unknown) => unknown>>;
    reinit(factory: (runtime: unknown) => unknown, themes: string[]): void;
    getStyles(
      classes: string,
      props: unknown,
      state: unknown,
      context: Context
    ): { styles: Record<string, unknown> };
  };
  ScopedVariables: typeof import("uniwind").ScopedVariables;
  useResolveClassNames: typeof import("uniwind").useResolveClassNames;
  withUniwind: typeof import("uniwind").withUniwind;
  UniwindContext: unknown;
  buildScopedVariablesContext(parent: Context, variables: Variables): Context;
};

const projectRoot = path.resolve(import.meta.dir, "..");
const uniwindSrc = path.join(projectRoot, "node_modules/uniwind/src");
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "yeoyu-uniwind-test-"));
const entryFile = path.join(temporaryRoot, "entry.ts");
await Bun.write(
  entryFile,
  [
    `export {compileCSS} from ${JSON.stringify(
      path.join(uniwindSrc, "bundler/css-compiler/compileCSS.ts")
    )};`,
    `export {UniwindBundlerConfig} from ${JSON.stringify(
      path.join(uniwindSrc, "bundler/config.ts")
    )};`,
    `export {UniwindStore} from ${JSON.stringify(
      path.join(uniwindSrc, "core/native/store.ts")
    )};`,
    `export {UniwindContext} from ${JSON.stringify(
      path.join(uniwindSrc, "core/context.ts")
    )};`,
    `export {ScopedVariables} from ${JSON.stringify(
      path.join(
        uniwindSrc,
        "components/ScopedVariables/ScopedVariables.native.tsx"
      )
    )};`,
    `export {buildScopedVariablesContext} from ${JSON.stringify(
      path.join(uniwindSrc, "components/ScopedVariables/utils.ts")
    )};`,
    `export {useResolveClassNames} from ${JSON.stringify(
      path.join(uniwindSrc, "hooks/useResolveClassNames.native.ts")
    )};`,
    `export {withUniwind} from ${JSON.stringify(
      path.join(uniwindSrc, "hoc/withUniwind.native.tsx")
    )};`,
  ].join("\n")
);

const build = await Bun.build({
  entrypoints: [entryFile],
  target: "bun",
  define: { __DEV__: "false" },
  plugins: [
    {
      name: "isolated-uniwind-native-runtime",
      setup(builder) {
        builder.onResolve({ filter: /^react-native$/ }, () => ({
          path: path.join(
            import.meta.dir,
            "fixtures/uniwind-native-adapter.js"
          ),
        }));
        builder.onResolve({ filter: /^@\// }, (args) =>
          args.importer.startsWith(`${uniwindSrc}${path.sep}`)
            ? {
                path: Bun.resolveSync(
                  path.join(uniwindSrc, args.path.slice(2)),
                  args.importer
                ),
              }
            : undefined
        );
        builder.onResolve({ filter: /^(?![./])[^:]+$/ }, (args) => ({
          path: Bun.resolveSync(args.path, args.importer),
          external: true,
        }));
      },
    },
  ],
});
if (!build.success) throw new Error(build.logs.map(String).join("\n"));
const engine = (await import(
  `data:text/javascript;base64,${Buffer.from(
    await build.outputs[0].text()
  ).toString("base64")}`
)) as Engine;
const config = engine.UniwindBundlerConfig.fromMetroConfig(
  { cssEntryFile: "./global.css" },
  "android"
);
const compiled = await engine.compileCSS(config);
engine.UniwindStore.reinit(
  new Function("rt", `return ${compiled}`) as (runtime: unknown) => unknown,
  ["light", "dark"]
);
await rm(temporaryRoot, { recursive: true, force: true });

const emptyContext: Context = { scopedTheme: null, rtl: null, variables: null };

/** Uses the actual installed native store against the actual compiled CSS. */
export function resolveTestClassNames(
  className: string | undefined,
  theme?: Theme
): Record<string, unknown> {
  const variables =
    theme &&
    Object.fromEntries(
      Object.entries(theme).map(([key, value]) => [
        `--color-${key.replace(
          /[A-Z]/g,
          (letter) => `-${letter.toLowerCase()}`
        )}`,
        value,
      ])
    );
  const context = variables
    ? engine.buildScopedVariablesContext(emptyContext, variables)
    : emptyContext;
  return engine.UniwindStore.getStyles(
    className ?? "",
    undefined,
    undefined,
    context
  ).styles;
}

export function resolveTestVariable(name: string): unknown {
  const variables = engine.UniwindStore.vars.light;
  return variables[name]?.(variables);
}

// Bun does not select React Native conditional exports or Metro's RN host
// adapters. Keep native Uniwind behavior and replace only that resolution seam.
mock.module("uniwind", () => ({
  ScopedVariables: engine.ScopedVariables,
  useResolveClassNames: engine.useResolveClassNames,
  withUniwind: engine.withUniwind,
}));

export const NativeUniwindContext = engine.UniwindContext;
