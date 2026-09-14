/** Matched metadata workload. This does not measure Android, disk, web pages or input readiness. */
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import type { BrowserCommands, BrowserStorage } from "../src/BrowserController";
import type { Snapshot } from "../generated/types";

const args = process.argv.slice(2);
const option = (name: string) => args[args.indexOf(name) + 1];
if (!args.includes("--controller") || !args.includes("--out")) throw Error("Usage: bun scripts/measure-controller.ts --controller path --out path");
const source = resolve(option("--controller"));
const { BrowserController } = await import(pathToFileURL(source).href);
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
const rows = [];
for (const count of [10, 50, 100, 500]) {
  for (const mode of ["ordinary", "private"] as const) {
    for (let run = 1; run <= 3; run++) {
      let state: Snapshot = {
        version: 1, revision: 0, lastExternalRequestId: "", activeWorkspaceId: "work", activeTabId: "private",
        workspaces: [{id: "work", name: "Fixture", color: "", lastActiveTabId: "private"}],
        tabs: Array.from({length: count}, (_, i) => ({id: i === count - 1 ? "private" : `tab-${i}`, workspaceId: "work", url: `https://example.invalid/${i}`, title: `Fixture ${i}`, private: i === count - 1, updatedAt: 0})),
        bookmarks: [], bookmarkFolders: [], keyBindings: [], keymapVersion: 1,
      };
      let writes = 0, bytes = 0;
      const unsupported = async (): Promise<Snapshot> => { throw Error("Unexpected command in metadata workload"); };
      const commands: BrowserCommands = {
        ready: async () => {}, browserSnapshot: async () => structuredClone(state), snapshotRestore: unsupported,
        tabNavigated: async ({tabId, url, title}) => {
          state = {...state, revision: state.revision + 1, tabs: state.tabs.map((tab) => tab.id === tabId ? {...tab, url, title, updatedAt: state.revision + 1} : tab)};
          return structuredClone(state);
        },
        workspaceCreate: unsupported, tabCreate: unsupported, tabActivate: unsupported, tabClose: unsupported,
        tabReset: unsupported, tabSetFavorite: unsupported, tabSetPinned: unsupported, tabMove: unsupported,
        tabSetWorkspace: unsupported, workspaceActivate: unsupported, keymapSet: unsupported,
        bookmarkOpen: unsupported, bookmarkCreate: unsupported, bookmarkUpdate: unsupported,
        bookmarkRemove: unsupported, bookmarkMove: unsupported, bookmarkFolderCreate: unsupported,
        bookmarkFolderRename: unsupported, bookmarkFolderRemove: unsupported, bookmarkSetFolder: unsupported,
      };
      const storage: BrowserStorage = {
        reconcileTabs() {}, configureKeys() {}, readSnapshot: async () => null,
        saveSnapshot: async (json) => { writes++; bytes += Buffer.byteLength(json); },
      };
      const controller = new BrowserController(commands, storage);
      await controller.initialize(); await controller.flush();
      writes = 0; bytes = 0;
      controller.performance?.setEnabled(true);
      const samplesMs: number[] = [];
      for (let i = 0; i < 30; i++) {
        const start = performance.now();
        await controller.navigated({tabId: mode === "private" ? "private" : "tab-0", url: `https://example.invalid/change/${i}`, title: `Change ${i}`, loading: false, canGoBack: false, canGoForward: false});
        await controller.flush();
        samplesMs.push(performance.now() - start);
      }
      rows.push({ metadataTabs: count, privateMetadataTabs: 1, liveSessions: 0, mode, run, repetitions: samplesMs.length, writes, bytes, medianMs: percentile(samplesMs, 0.5), p95Ms: percentile(samplesMs, 0.95), samplesMs, phases: controller.performance?.snapshot().phases ?? null });
    }
  }
}
const result = { schema: 1, capturedAt: new Date().toISOString(), runtime: `Bun ${Bun.version}`, platform: process.platform, arch: process.arch, controllerSha256: digest(source), workloadSha256: digest(new URL(import.meta.url).pathname), boundary: "Host metadata only, mocked commands and memory storage. Counts are native save requests and UTF-8 payload bytes, not physical disk I/O. No Android, Gecko, render/input readiness, live sites, PSS or energy measurements. Runs remain separate; timings have no device-performance pass threshold.", rows };
await Bun.write(resolve(option("--out")), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({runs: rows.length, repetitions: rows.reduce((n, row) => n + row.repetitions, 0), privateWrites: rows.filter((row) => row.mode === "private").reduce((n, row) => n + row.writes, 0), ordinaryWrites: rows.filter((row) => row.mode === "ordinary").reduce((n, row) => n + row.writes, 0)}));
