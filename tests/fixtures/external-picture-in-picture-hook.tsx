import { mock } from "bun:test";
import assert from "node:assert/strict";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type {
  ExternalPictureInPictureRuntime,
  ExternalPictureInPictureState,
} from "../../src/hooks/useExternalPictureInPicture";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const listeners = new Set<(value: unknown) => void>();
const appListeners = new Set<(value: string) => void>();
mock.module("react-native", () => ({
  NativeEventEmitter: class {
    addListener(name: string, listener: (value: unknown) => void) {
      assert.equal(name, "BrowserExternalPictureInPicture");
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    }
  },
  AppState: {
    addEventListener(name: string, listener: (value: string) => void) {
      assert.equal(name, "change");
      appListeners.add(listener);
      return { remove: () => appListeners.delete(listener) };
    },
  },
}));
mock.module("../../src/platform", () => ({ platform: {} }));
const { useExternalPictureInPicture } = await import(
  "../../src/hooks/useExternalPictureInPicture"
);
type Options = Parameters<typeof useExternalPictureInPicture>[0];
const idle: ExternalPictureInPictureState = {
  supported: true,
  allowed: true,
  active: false,
  transitioning: false,
  tabId: null,
  sequence: 1,
};
const emit = (value: unknown) =>
  listeners.forEach((listener) => listener(value));
const resume = () => appListeners.forEach((listener) => listener("active"));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
const makeRuntime = (overrides: ExternalPictureInPictureRuntime = {}) => {
  const configs: Array<[boolean, string, boolean]> = [];
  const acks: number[] = [];
  const runtime: ExternalPictureInPictureRuntime = {
    getExternalPictureInPictureState: async () => JSON.stringify(idle),
    configureExternalPictureInPicture: (...args) => {
      configs.push(args);
    },
    acknowledgeExternalPictureInPictureReturn: (token) => {
      acks.push(token);
    },
    ...overrides,
  };
  return { runtime, configs, acks };
};
const mount = async (initial: Partial<Options> = {}, strict = false) => {
  let current!: ReturnType<typeof useExternalPictureInPicture>;
  let renderer!: ReactTestRenderer;
  let options: Options = {
    enabled: true,
    visibleTabIds: ["a"],
    blocked: false,
    onReturn: async () => {},
    ...initial,
  };
  function Harness(props: Options) {
    current = useExternalPictureInPicture(props);
    return null;
  }
  await act(async () => {
    renderer = create(
      strict ? (
        <React.StrictMode>
          <Harness {...options} />
        </React.StrictMode>
      ) : (
        <Harness {...options} />
      )
    );
  });
  return {
    state: () => current.state,
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
  "query-race": async () => {
    const read = deferred<string>();
    const { runtime } = makeRuntime({
      getExternalPictureInPictureState: () => {
        emit({ ...idle, active: true, tabId: "a", sequence: 3 });
        return read.promise;
      },
    });
    const hook = await mount({ runtime });
    await act(async () => read.resolve(JSON.stringify(idle)));
    assert.equal(hook.state().active, true);
    await act(async () => emit({ ...idle, sequence: 2 }));
    assert.equal(hook.state().sequence, 3);
    await hook.unmount();
  },
  configure: async () => {
    const { runtime, configs } = makeRuntime();
    const hook = await mount({ runtime });
    await hook.update({ visibleTabIds: ["a"], onReturn: async () => {} });
    assert.equal(
      configs.length,
      1,
      "equal pane IDs must not reconfigure on render"
    );
    await hook.update({
      enabled: false,
      visibleTabIds: ["a", "b"],
      blocked: true,
    });
    assert.deepEqual(configs.at(-1), [false, '["a","b"]', true]);
    await hook.unmount();
    assert.deepEqual(configs.at(-1), [false, "[]", true]);
  },
  "return-once": async () => {
    const { runtime, acks } = makeRuntime();
    const returned: string[] = [];
    const release = deferred<void>();
    const hook = await mount({
      runtime,
      onReturn: async (id) => {
        returned.push(id);
        await release.promise;
      },
    });
    const event = { ...idle, sequence: 4, returnTabId: "a", returnToken: 9 };
    await act(async () => {
      emit(event);
      emit(event);
    });
    assert.deepEqual(returned, ["a"]);
    assert.deepEqual(acks, [], "do not acknowledge before selection resolves");
    await act(async () => release.resolve());
    assert.deepEqual(acks, [9]);
    await hook.update({
      onReturn: async (id) => {
        returned.push(`new:${id}`);
      },
    });
    await act(async () => {
      emit(event);
      emit({ ...event, sequence: 5, returnTabId: "b", returnToken: 10 });
    });
    assert.deepEqual(returned, ["a", "new:b"]);
    assert.deepEqual(acks, [9, 10]);
    await hook.unmount();
  },
  "strict-return": async () => {
    const event = { ...idle, sequence: 4, returnTabId: "a", returnToken: 9 };
    const { runtime, acks } = makeRuntime({
      getExternalPictureInPictureState: async () => {
        emit(event);
        return JSON.stringify(event);
      },
    });
    const release = deferred<void>();
    let returns = 0;
    const hook = await mount(
      {
        runtime,
        onReturn: async () => {
          returns++;
          await release.promise;
        },
      },
      true
    );
    assert.equal(
      returns,
      1,
      "StrictMode effect replay must not duplicate a pending return"
    );
    await act(async () => release.resolve());
    assert.deepEqual(acks, [9]);
    await hook.unmount();
  },
  "return-failure": async () => {
    const { runtime, acks } = makeRuntime();
    const errors: string[] = [];
    const hook = await mount({
      runtime,
      onReturn: async () => {
        throw Error("tab closed");
      },
      onError: (error) => errors.push(error),
    });
    await act(async () =>
      emit({ ...idle, sequence: 2, returnTabId: "a", returnToken: 3 })
    );
    assert.equal(errors.length, 1);
    assert.match(errors[0], /tab closed/);
    assert.deepEqual(acks, [3]);
    await hook.unmount();
  },
  validation: async () => {
    const errors: string[] = [];
    const hook = await mount({
      runtime: makeRuntime().runtime,
      onError: (error) => errors.push(error),
    });
    await act(async () => {
      for (const bad of [
        { ...idle, sequence: -1 },
        { ...idle, sequence: 1.2 },
        { ...idle, returnTabId: "a" },
        { ...idle, returnToken: 7 },
        { ...idle, returnTabId: "a", returnToken: Infinity },
        { ...idle, active: "yes" },
      ])
        emit(bad);
      emit(JSON.stringify({ ...idle, sequence: 2, active: true, tabId: "a" }));
    });
    assert.equal(errors.length, 6);
    assert.equal(hook.state().active, true);
    await hook.unmount();
  },
  resume: async () => {
    const reads = [deferred<string>(), deferred<string>(), deferred<string>()];
    let count = 0;
    const hook = await mount({
      runtime: makeRuntime({
        getExternalPictureInPictureState: () => reads[count++].promise,
      }).runtime,
    });
    await act(async () => {
      resume();
      resume();
    });
    await act(async () =>
      reads[2].resolve(JSON.stringify({ ...idle, allowed: false }))
    );
    await act(async () => {
      reads[0].resolve(JSON.stringify(idle));
      reads[1].resolve(JSON.stringify(idle));
    });
    assert.equal(hook.state().allowed, false);
    await hook.unmount();
  },
  cleanup: async () => {
    const read = deferred<string>();
    const old = makeRuntime({
      getExternalPictureInPictureState: () => read.promise,
    });
    const hook = await mount({ runtime: old.runtime });
    const stale = [...listeners][0];
    await hook.update({ runtime: makeRuntime().runtime });
    await act(async () => {
      stale({ ...idle, active: true, sequence: 10, tabId: "old" });
      read.resolve(
        JSON.stringify({ ...idle, active: true, sequence: 11, tabId: "old" })
      );
    });
    assert.equal(hook.state().active, false);
    assert.deepEqual(old.configs.at(-1), [false, "[]", true]);
    await hook.unmount();
    assert.equal(listeners.size, 0);
    assert.equal(appListeners.size, 0);
  },
  "old-binary": async () => {
    const hook = await mount();
    assert.equal(hook.state().supported, false);
    assert.equal(hook.state().active, false);
    await hook.unmount();
  },
};
const scenario = process.argv[2];
assert.ok(scenarios[scenario], `unknown scenario ${scenario}`);
await scenarios[scenario]();
console.log(JSON.stringify({ scenario, passed: true }));
