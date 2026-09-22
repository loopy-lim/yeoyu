import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppState, DeviceEventEmitter } from "react-native";
import { controller } from "../controllerRuntime";
import { platform } from "../platform";
import { BrowserToolsStore, ExternalLinkDrain, parseBrowserTools, parseExternalLinks, retainLiveTabs, type BrowserToolsConfig, type BrowserToolsUpdate } from "../browserWorkflows";
import type { Snapshot } from "../../generated/types";

export interface BrowserSecurity {
  tabId: string;
  origin: string;
  host: string;
  secure: boolean;
  known?: boolean;
  exception: boolean;
  mixedActive: boolean;
  mixedPassive: boolean;
  issuer?: string;
  expiresAt?: number;
}

export interface BrowserContentRequest {
  requestId: string;
  tabId: string;
  linkUri?: string;
  imageUri?: string;
  title?: string;
}
export type ContentAction = "open" | "copy" | "share";

export function useBrowserWorkflows(options: {
  onError(message: string): void;
  onNotice(message: string): void;
  onExternalTab(snapshot: Snapshot): void;
  onCommand(command: string): void;
}) {
  const callbacks = useRef(options);
  useLayoutEffect(() => { callbacks.current = options; }, [options]);
  const [ready, setReady] = useState(false);
  const [startupError, setStartupError] = useState("");
  const [config, setConfig] = useState<BrowserToolsConfig | null>(null);
  const [settings] = useState(() => new BrowserToolsStore(
    (next) => platform.configureBrowserTools(JSON.stringify(next)),
    setConfig,
    async () => parseBrowserTools(await platform.initializeBrowserTools()),
  ));
  const [security, setSecurity] = useState<Record<string, BrowserSecurity>>({});
  const [context, setContext] = useState<BrowserContentRequest | null>(null);
  const contextRequest = useRef<BrowserContentRequest | null>(null);
  const [startupAttempt, retryStartup] = useState(0);
  const [links] = useState(() => new ExternalLinkDrain({
    pending: async () => parseExternalLinks(await platform.pendingExternalLinks()),
    open: async (url, id) => {
      const snapshot = await controller.openExternal(id, url);
      callbacks.current.onExternalTab(snapshot);
    },
    flush: () => controller.flush(),
    acknowledge: (id) => platform.acknowledgeExternalLink(id),
    reject: (id) => platform.rejectExternalLink(id),
  }));

  // Initialization itself can quarantine a corrupt saved session. Listen before
  // requesting it, while the first Surface is still behind the ready gate.
  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener("BrowserSessionStorageError", (event: { message: string }) => callbacks.current.onError(event.message));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    let live = true;
    setStartupError("");
    void Promise.resolve().then(() => platform.initializeBrowserTools()).then((json) => {
      if (!live) return;
      settings.initialize(parseBrowserTools(json));
      setReady(true);
    }).catch((error) => {
      if (live) setStartupError(String(error));
    });
    return () => { live = false; };
  }, [settings, startupAttempt]);

  useEffect(() => {
    if (!ready) return;
    let live = true;
    // Launcher shortcuts queue natively through the cold-start gap; one drain
    // per React mount replays them as browser commands. Warm taps deliver
    // live as BrowserCommand events instead.
    void Promise.resolve()
      .then(() => platform.pendingShortcutCommands?.() ?? "[]")
      .then((json) => {
        if (!live) return;
        for (const command of JSON.parse(json) as string[]) callbacks.current.onCommand(command);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    let live = true;
    const report = (error: unknown) => { if (live) callbacks.current.onError(String(error)); };
    const drain = () => { void links.run().catch(report); };
    const valid = (id: string) => controller.snapshot?.tabs.some((tab) => tab.id === id && !tab.suspended) === true;
    const subscriptions = [
      DeviceEventEmitter.addListener("BrowserExternalLinksChanged", drain),
      DeviceEventEmitter.addListener("BrowserSecurity", (event: BrowserSecurity) => {
        if (valid(event.tabId)) setSecurity((old) => ({ ...old, [event.tabId]: event }));
      }),
      DeviceEventEmitter.addListener("BrowserExternalLinkFailed", (event: { error: string }) => report(event.error)),
      DeviceEventEmitter.addListener("BrowserExternalNavigationFailed", (event: { tabId: string; error: string }) => { if (valid(event.tabId)) report(event.error); }),
      DeviceEventEmitter.addListener("BrowserTextScale", (event: { textScale: number }) => {
        settings.acceptTextScale(event.textScale);
      }),
      DeviceEventEmitter.addListener("BrowserContentContextMenu", (event: BrowserContentRequest) => {
        if (valid(event.tabId)) { contextRequest.current = event; setContext(event); }
      }),
      DeviceEventEmitter.addListener("BrowserSessionBlocked", (event: { tabId: string; reason: string }) => {
        if (valid(event.tabId)) callbacks.current.onError(`Page recovery paused: ${event.reason}. Use Reload to try again.`);
      }),
      AppState.addEventListener("change", (state) => { if (state === "active") drain(); }),
    ];
    const unsubscribe = controller.subscribe(() => {
      const tabs = controller.snapshot?.tabs;
      if (tabs) setSecurity((old) => retainLiveTabs(old, new Set(tabs.map((tab) => tab.id))));
    });
    drain();
    return () => { live = false; unsubscribe(); subscriptions.forEach((subscription) => subscription.remove()); };
  }, [links, ready, settings]);

  const saveConfig = useCallback((update: BrowserToolsUpdate) => settings.save(update), [settings]);

  const selectContext = useCallback(async (requestId: string, target: "link" | "image", action: ContentAction) => {
    try {
      const request = contextRequest.current;
      if (!request || request.requestId !== requestId) throw new Error("This page action has expired");
      const before = controller.snapshot;
      const source = before?.tabs.find((tab) => tab.id === request.tabId && !tab.suspended);
      if (!source || !before) throw new Error("The source tab is no longer available");
      const url = await platform.consumeContentContext(requestId, target);
      if (action === "open") {
        const live = controller.snapshot?.tabs.find((tab) => tab.id === source.id && !tab.suspended);
        if (!live || !!live.private !== !!source.private) throw new Error("The source tab is no longer available");
        callbacks.current.onExternalTab(await controller.createTab(url,
          source.favorite ? before.activeWorkspaceId : source.workspaceId, { private: !!source.private }));
      }
      else if (action === "copy") { platform.copyToClipboard(url); callbacks.current.onNotice("Link copied"); }
      else await platform.shareUrl(url);
    } catch (error) { callbacks.current.onError(String(error)); }
    finally {
      if (contextRequest.current?.requestId === requestId) contextRequest.current = null;
      setContext((old) => old?.requestId === requestId ? null : old);
    }
  }, []);

  return { ready, startupError, retryStartup: () => retryStartup((v) => v + 1), config, saveConfig, security, context, selectContext, closeContext: () => { contextRequest.current = null; setContext(null); } };
}
