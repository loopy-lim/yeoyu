import { expect, test } from "bun:test";
import { fileURLToPath, URL } from "node:url";

const scenarios = [
  [
    "event-before-query",
    "PiP subscribes before querying and a late initial snapshot cannot replace a live event",
  ],
  [
    "configure",
    "PiP config follows current settings and target without replacing subscriptions",
  ],
  [
    "event-validation",
    "PiP accepts native objects and JSON while ignoring malformed or out-of-order states",
  ],
  [
    "restored-width",
    "PiP preserves restored window width from queries and reflects changed or cleared event widths",
  ],
  [
    "restored-width-validation",
    "PiP rejects invalid restored window widths without replacing the last valid state",
  ],
  [
    "resume",
    "only the newest app-resume PiP query may update native permission state",
  ],
  ["old-binary", "PiP controls are safe when an older binary has no PiP API"],
  [
    "actions",
    "manual PiP entry works with automatic entry off and invalidates a pending startup read",
  ],
  [
    "unsequenced-entry",
    "PiP manual entry supersedes a pending snapshot when native states omit sequence numbers",
  ],
  [
    "action-race",
    "a late entry result cannot overwrite a newer native exit event",
  ],
  [
    "failures",
    "PiP failures reach the latest callback and settings can recover on app resume",
  ],
  [
    "entry-error-after-query",
    "PiP entry failures are reported even when a state refresh completed while entry was pending",
  ],
  [
    "cleanup",
    "PiP runtime replacement and unmount reject old events and pending callbacks",
  ],
] as const;

for (const [scenario, name] of scenarios) {
  test(name, () => {
    const result = Bun.spawnSync(
      [
        process.execPath,
        fileURLToPath(
          new URL("./fixtures/picture-in-picture-hook.tsx", import.meta.url)
        ),
        scenario,
      ],
      { stdout: "pipe", stderr: "pipe" }
    );
    if (result.exitCode !== 0) throw Error(result.stderr.toString());
    expect(JSON.parse(result.stdout.toString())).toEqual({
      scenario,
      passed: true,
    });
  });
}
