// Native mocks stay in this process so other Bun component tests remain isolated.
import { mock } from "bun:test";
import assert from "node:assert/strict";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type {
  PictureInPictureRuntime,
  PictureInPictureState,
} from "../../src/hooks/usePictureInPicture";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const listeners = new Set<(payload: unknown) => void>();
const appListeners = new Set<(state: string) => void>();
const capturedListeners: Array<(payload: unknown) => void> = [];
const defaultRuntime: PictureInPictureRuntime = {};
mock.module("react-native", () => ({
  NativeEventEmitter: class {
    addListener(name: string, listener: (payload: unknown) => void) {
      assert.equal(name, "BrowserPictureInPicture");
      listeners.add(listener);
      capturedListeners.push(listener);
      return { remove: () => listeners.delete(listener) };
    }
  },
  AppState: {
    addEventListener(name: string, listener: (state: string) => void) {
      assert.equal(name, "change");
      appListeners.add(listener);
      return { remove: () => appListeners.delete(listener) };
    },
  },
}));
mock.module("../../src/platform", () => ({ platform: defaultRuntime }));
const { usePictureInPicture } = await import(
  "../../src/hooks/usePictureInPicture"
);

type Options = Parameters<typeof usePictureInPicture>[0];
type Result = ReturnType<typeof usePictureInPicture>;
const idle: PictureInPictureState = {
  supported: true,
  allowed: true,
  active: false,
  transitioning: false,
  autoEnterEnabled: true,
  tabId: "video-a",
  sequence: 1,
};
const emit = (payload: unknown) =>
  listeners.forEach((listener) => listener(payload));
const appState = (state: string) =>
  appListeners.forEach((listener) => listener(state));
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  void promise.catch(() => {});
  return { promise, resolve, reject };
};
const makeRuntime = (overrides: PictureInPictureRuntime = {}) => {
  const configurations: Array<[boolean, string | null, boolean]> = [];
  const runtime: PictureInPictureRuntime = {
    getPictureInPictureState: async () => JSON.stringify(idle),
    configurePictureInPicture: (enabled, tabId, blocked) =>
      configurations.push([enabled, tabId, blocked]),
    enterPictureInPicture: async () =>
      JSON.stringify({ ...idle, active: true, sequence: 2 }),
    openPictureInPictureSettings: async () => {},
    ...overrides,
  };
  return { runtime, configurations };
};
const mount = async (initial: Partial<Options> = {}) => {
  let current!: Result;
  let renderer!: ReactTestRenderer;
  let options: Options = {
    enabled: true,
    tabId: "video-a",
    blocked: false,
    ...initial,
  };
  function Harness(props: Options) {
    current = usePictureInPicture(props);
    return null;
  }
  await act(async () => {
    renderer = create(<Harness {...options} />);
  });
  return {
    result: () => current,
    update: async (next: Partial<Options>) => {
      options = { ...options, ...next };
      await act(async () => renderer.update(<Harness {...options} />));
    },
    unmount: async () => {
      await act(async () => renderer.unmount());
    },
  };
};

const scenarios: Record<string, () => Promise<void>> = {
  "event-before-query": async () => {
    const read = deferred<string>();
    Object.assign(
      defaultRuntime,
      makeRuntime({
        getPictureInPictureState: () => {
          emit({ ...idle, active: true, sequence: undefined });
          return read.promise;
        },
      }).runtime
    );
    const hook = await mount();
    assert.equal(
      hook.result().state.active,
      true,
      "listener must precede the query's synchronous native event"
    );
    await act(async () =>
      read.resolve(JSON.stringify({ ...idle, sequence: undefined }))
    );
    assert.equal(
      hook.result().state.active,
      true,
      "late initial query must not replace a live event"
    );
    assert.equal(hook.result().state.sequence, undefined);
    await hook.unmount();
  },
  configure: async () => {
    let reads = 0;
    const { runtime, configurations } = makeRuntime({
      getPictureInPictureState: async () => {
        reads++;
        return JSON.stringify(idle);
      },
    });
    const hook = await mount({ runtime });
    assert.deepEqual(configurations, [[true, "video-a", false]]);
    await hook.update({ enabled: false, tabId: "video-b", blocked: true });
    assert.deepEqual(configurations.at(-1), [false, "video-b", true]);
    await hook.update({ onError() {} });
    assert.equal(
      configurations.length,
      2,
      "callback-only render must not reconfigure native PiP"
    );
    assert.equal(
      reads,
      1,
      "configuration changes must not recreate subscriptions or initial query"
    );
    assert.equal(listeners.size, 1);
    assert.equal(appListeners.size, 1);
    await hook.unmount();
    assert.deepEqual(
      configurations.at(-1),
      [false, null, true],
      "unmounted UI must disarm its native auto-entry target"
    );
    assert.equal(listeners.size, 0);
    assert.equal(appListeners.size, 0);
  },
  "event-validation": async () => {
    const errors: string[] = [];
    const hook = await mount({
      runtime: makeRuntime().runtime,
      onError: (error) => errors.push(error),
    });
    await act(async () => emit({ ...idle, active: true, sequence: 4 }));
    assert.equal(hook.result().state.active, true);
    await act(async () => {
      emit({ ...idle, sequence: 3 });
      emit({ active: false, sequence: 5 });
      emit("not-json");
    });
    assert.equal(
      hook.result().state.active,
      true,
      "stale and malformed native events must preserve the last valid state"
    );
    assert.equal(hook.result().state.sequence, 4);
    await act(async () =>
      emit(
        JSON.stringify({
          ...idle,
          allowed: false,
          reason: "permission",
          sequence: 5,
        })
      )
    );
    assert.equal(hook.result().state.active, false);
    assert.equal(hook.result().state.allowed, false);
    assert.equal(hook.result().state.reason, "permission");
    await hook.unmount();
  },
  "restored-width": async () => {
    const read = deferred<string>();
    let reads = 0;
    const hook = await mount({
      runtime: makeRuntime({
        getPictureInPictureState: () =>
          ++reads === 1
            ? Promise.resolve(
                JSON.stringify({ ...idle, restoredWindowWidth: 960.5 })
              )
            : read.promise,
      }).runtime,
    });
    assert.equal(hook.result().state.restoredWindowWidth, 960.5);
    await act(async () => emit({ ...idle, transitioning: true, sequence: 2 }));
    assert.equal(
      hook.result().state.restoredWindowWidth,
      undefined,
      "entry must clear the previous restoration width when native omits it"
    );
    await act(async () => appState("active"));
    await act(async () =>
      emit({ ...idle, restoredWindowWidth: 640, sequence: 3 })
    );
    assert.equal(hook.result().state.restoredWindowWidth, 640);
    await act(async () =>
      emit(JSON.stringify({ ...idle, restoredWindowWidth: 800, sequence: 4 }))
    );
    assert.equal(
      hook.result().state.restoredWindowWidth,
      800,
      "width-only changes from the restored native layout must reach React"
    );
    await act(async () =>
      read.resolve(JSON.stringify({ ...idle, restoredWindowWidth: 960.5 }))
    );
    assert.equal(
      hook.result().state.restoredWindowWidth,
      800,
      "a late resume snapshot must not restore an obsolete window width"
    );
    await act(async () => emit({ ...idle, sequence: 5 }));
    assert.equal(hook.result().state.restoredWindowWidth, undefined);
    await hook.unmount();
  },
  "restored-width-validation": async () => {
    const errors: string[] = [];
    const hook = await mount({
      runtime: makeRuntime().runtime,
      onError: (error) => errors.push(error),
    });
    assert.equal(
      hook.result().state.supported,
      true,
      "old native states without a restored width remain valid"
    );
    assert.equal(hook.result().state.restoredWindowWidth, undefined);
    await act(async () =>
      emit({ ...idle, restoredWindowWidth: 720, sequence: 2 })
    );
    for (const width of [NaN, Infinity, -Infinity, 0, -1, "720", null]) {
      await act(async () =>
        emit({
          ...idle,
          active: true,
          restoredWindowWidth: width,
          sequence: 99,
        })
      );
      assert.equal(hook.result().state.restoredWindowWidth, 720);
      assert.equal(hook.result().state.active, false);
      assert.equal(hook.result().state.sequence, 2);
    }
    assert.equal(errors.length, 7, "invalid widths must be reported");
    await act(async () =>
      emit({ ...idle, restoredWindowWidth: 720.25, sequence: 3 })
    );
    assert.equal(
      hook.result().state.restoredWindowWidth,
      720.25,
      "invalid events must not advance the accepted native sequence"
    );
    await hook.unmount();
  },
  resume: async () => {
    const reads: Array<ReturnType<typeof deferred<string>>> = [];
    const runtime = makeRuntime({
      getPictureInPictureState: () => {
        const read = deferred<string>();
        reads.push(read);
        return read.promise;
      },
    }).runtime;
    const hook = await mount({ runtime });
    assert.equal(reads.length, 1, "mount must request an initial native state");
    await act(async () =>
      reads[0].resolve(JSON.stringify({ ...idle, sequence: undefined }))
    );
    await act(async () => appState("background"));
    assert.equal(reads.length, 1);
    await act(async () => appState("active"));
    await act(async () => appState("active"));
    assert.equal(
      reads.length,
      3,
      "each foreground activation must refresh OS permission state"
    );
    await act(async () =>
      reads[2].resolve(
        JSON.stringify({ ...idle, allowed: false, sequence: undefined })
      )
    );
    await act(async () =>
      reads[1].resolve(JSON.stringify({ ...idle, sequence: undefined }))
    );
    assert.equal(
      hook.result().state.allowed,
      false,
      "older resume query must not overwrite the latest query"
    );
    assert.equal(hook.result().state.sequence, undefined);
    await hook.unmount();
  },
  "old-binary": async () => {
    const errors: string[] = [];
    const hook = await mount({
      runtime: {},
      onError: (error) => errors.push(error),
    });
    assert.equal(hook.result().state.supported, false);
    assert.equal(hook.result().state.active, false);
    await act(async () => {
      assert.equal(await hook.result().enter(), null);
      await hook.result().openSettings();
    });
    await act(async () => appState("active"));
    assert.deepEqual(errors, []);
    assert.equal(listeners.size, 0, "old binaries need no PiP subscription");
    await hook.unmount();
  },
  actions: async () => {
    const read = deferred<string>();
    let entries = 0;
    const runtime = makeRuntime({
      getPictureInPictureState: () => read.promise,
      enterPictureInPicture: async () => {
        entries++;
        return JSON.stringify({ ...idle, active: true, sequence: 2 });
      },
    }).runtime;
    const hook = await mount({ runtime, enabled: false });
    await act(async () => {
      const result = await hook.result().enter();
      assert.equal(
        result?.active,
        true,
        "manual entry remains available when automatic entry is off"
      );
    });
    assert.equal(entries, 1);
    assert.equal(hook.result().state.active, true);
    await act(async () => read.resolve(JSON.stringify(idle)));
    assert.equal(
      hook.result().state.active,
      true,
      "entry result supersedes pending startup snapshot"
    );
    await hook.unmount();
  },
  "unsequenced-entry": async () => {
    const read = deferred<string>(),
      entry = deferred<string>();
    const hook = await mount({
      runtime: makeRuntime({
        getPictureInPictureState: () => read.promise,
        enterPictureInPicture: () => entry.promise,
      }).runtime,
    });
    let pending!: ReturnType<Result["enter"]>;
    await act(async () => {
      pending = hook.result().enter();
    });
    await act(async () =>
      read.resolve(JSON.stringify({ ...idle, sequence: undefined }))
    );
    await act(async () => {
      entry.resolve(
        JSON.stringify({ ...idle, active: true, sequence: undefined })
      );
      await pending;
    });
    assert.equal(
      hook.result().state.active,
      true,
      "manual entry supersedes a snapshot requested before it even without native sequence numbers"
    );
    await hook.unmount();
  },
  "action-race": async () => {
    const entry = deferred<string>();
    const hook = await mount({
      runtime: makeRuntime({ enterPictureInPicture: () => entry.promise })
        .runtime,
    });
    let pending!: ReturnType<Result["enter"]>;
    await act(async () => {
      pending = hook.result().enter();
    });
    await act(async () => emit({ ...idle, active: true, sequence: 2 }));
    await act(async () => emit({ ...idle, active: false, sequence: 3 }));
    await act(async () => {
      entry.resolve(JSON.stringify({ ...idle, active: true, sequence: 2 }));
      await pending;
    });
    assert.equal(hook.result().state.active, false);
    assert.equal(
      hook.result().state.sequence,
      3,
      "a delayed entry result must not reopen an exited PiP state"
    );
    await hook.unmount();
  },
  failures: async () => {
    const oldErrors: string[] = [],
      latestErrors: string[] = [];
    const read = deferred<string>();
    let settingsOpened = 0;
    const runtime = makeRuntime({
      getPictureInPictureState: () => read.promise,
      enterPictureInPicture: async () => {
        throw Error("entry denied");
      },
      openPictureInPictureSettings: async () => {
        settingsOpened++;
      },
    }).runtime;
    const hook = await mount({
      runtime,
      onError: (error) => oldErrors.push(error),
    });
    await hook.update({ onError: (error) => latestErrors.push(error) });
    await act(async () => read.reject(Error("permission query unavailable")));
    await act(async () => {
      assert.equal(await hook.result().enter(), null);
      await hook.result().openSettings();
    });
    assert.deepEqual(oldErrors, []);
    assert.equal(latestErrors.length, 2);
    assert.match(latestErrors[0], /permission query unavailable/);
    assert.match(latestErrors[1], /entry denied/);
    assert.equal(settingsOpened, 1);
    runtime.getPictureInPictureState = async () =>
      JSON.stringify({ ...idle, allowed: true });
    await act(async () => appState("active"));
    assert.equal(
      hook.result().state.allowed,
      true,
      "returning from settings must recover after an initial query failure"
    );
    await hook.unmount();
  },
  "entry-error-after-query": async () => {
    const read = deferred<string>(),
      entry = deferred<string>();
    const errors: string[] = [];
    const hook = await mount({
      runtime: makeRuntime({
        getPictureInPictureState: () => read.promise,
        enterPictureInPicture: () => entry.promise,
      }).runtime,
      onError: (error) => errors.push(error),
    });
    let pending!: ReturnType<Result["enter"]>;
    await act(async () => {
      pending = hook.result().enter();
    });
    await act(async () => read.resolve(JSON.stringify(idle)));
    await act(async () => {
      entry.reject(Error("entry denied after refresh"));
      await pending;
    });
    assert.equal(
      errors.length,
      1,
      "refreshing state does not cancel a user's requested entry error"
    );
    assert.match(errors[0], /entry denied after refresh/);
    await hook.unmount();
  },
  cleanup: async () => {
    const oldRead = deferred<string>(),
      oldEntry = deferred<string>();
    const errors: string[] = [];
    let oldReads = 0;
    const oldRuntime = makeRuntime({
      getPictureInPictureState: () => {
        oldReads++;
        return oldRead.promise;
      },
      enterPictureInPicture: () => oldEntry.promise,
    });
    const hook = await mount({
      runtime: oldRuntime.runtime,
      onError: (error) => errors.push(error),
    });
    const staleLifecycle = [...appListeners][0];
    const staleListener = capturedListeners.at(-1)!;
    assert.equal(
      typeof staleListener,
      "function",
      "mounted hook must install a native listener"
    );
    let pending!: ReturnType<Result["enter"]>;
    await act(async () => {
      pending = hook.result().enter();
    });
    const nextRead = deferred<string>();
    const nextRuntime = makeRuntime({
      getPictureInPictureState: () => nextRead.promise,
    });
    await hook.update({ runtime: nextRuntime.runtime });
    await act(async () =>
      nextRead.resolve(
        JSON.stringify({ ...idle, tabId: "video-b", sequence: 1 })
      )
    );
    await act(async () => {
      oldRead.resolve(JSON.stringify({ ...idle, active: true, sequence: 99 }));
      oldEntry.reject(Error("obsolete entry failure"));
      staleListener({ ...idle, active: true, sequence: 100 });
      staleLifecycle("active");
      await pending;
    });
    assert.equal(hook.result().state.active, false);
    assert.equal(hook.result().state.tabId, "video-b");
    assert.equal(
      oldReads,
      1,
      "a queued foreground callback from a replaced hook must not start native work"
    );
    assert.deepEqual(
      errors,
      [],
      "a replaced runtime must not report errors into the new UI"
    );
    assert.equal(listeners.size, 1);
    assert.deepEqual(oldRuntime.configurations.at(-1), [false, null, true]);
    const lateResume = deferred<string>();
    nextRuntime.runtime.getPictureInPictureState = () => lateResume.promise;
    await act(async () => appState("active"));
    await hook.unmount();
    await act(async () => lateResume.reject(Error("query after unmount")));
    assert.equal(listeners.size, 0);
    assert.equal(appListeners.size, 0);
    assert.deepEqual(errors, []);
    await act(async () => {
      assert.equal(await hook.result().enter(), null);
      await hook.result().openSettings();
    });
  },
};
const scenario = process.argv[2];
assert.ok(scenarios[scenario], `unknown scenario: ${scenario}`);
await scenarios[scenario]();
process.stdout.write(JSON.stringify({ scenario, passed: true }) + "\n");
