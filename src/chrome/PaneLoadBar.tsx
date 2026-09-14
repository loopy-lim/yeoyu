import React, { useCallback, useSyncExternalStore } from "react";
import { DeviceEventEmitter } from "react-native";
import { TabProgressStore } from "../tabProgress";
import type { Theme } from "../theme";
import { LoadBar } from "./LoadBar";

const progress = new TabProgressStore((listener) => {
  const subscription = DeviceEventEmitter.addListener(
    "BrowserProgress",
    listener
  );
  return () => subscription.remove();
});

export function PaneLoadBar({
  tabId,
  theme,
  reducedMotion,
}: {
  tabId: string;
  theme: Theme;
  reducedMotion: boolean;
}) {
  const subscribe = useCallback(
    (listener: () => void) => progress.subscribe(tabId, listener),
    [tabId]
  );
  const getSnapshot = useCallback(() => progress.getSnapshot(tabId), [tabId]);
  const state = useSyncExternalStore(subscribe, getSnapshot);
  return (
    <LoadBar
      key={tabId}
      state={state}
      theme={theme}
      reducedMotion={reducedMotion}
    />
  );
}
