import { useCallback, useEffect, useRef, useState } from "react";
import { platform } from "../platform";
import { saveUiPreferences, type UiPreferences } from "../uiPreferences";
import type { SettingsSaveStatus } from "../components/SettingsDialog";

/** Serialize preference writes, including imports, and report only the newest save. */
export function useUiPreferencePersistence(
  ui: UiPreferences,
  hydrated: boolean,
  onError: (message: string) => void,
  failureMessage: string
) {
  const queue = useRef<Promise<void> | null>(null);
  const autoRevision = useRef(0);
  const [status, setStatus] = useState<SettingsSaveStatus>("loading");
  const [retry, setRetry] = useState(0);
  const failureMessageRef = useRef(failureMessage);
  useEffect(() => { failureMessageRef.current = failureMessage; }, [failureMessage]);
  const persist = useCallback(
    (preferences: UiPreferences, isCurrent: () => boolean = () => true) => {
      const write = (queue.current ?? Promise.resolve())
        .catch(() => {})
        .then(async () => {
          // A newer automatic save supersedes a queued intermediate drag/step.
          // Explicit archive imports use the default and are never skipped.
          if (!isCurrent()) return;
          if (typeof platform.saveUiPreferences !== "function")
            throw new Error("Saving preferences is unavailable.");
          await saveUiPreferences(
            platform.saveUiPreferences.bind(platform),
            preferences
          );
        });
      queue.current = write;
      return write;
    },
    []
  );

  useEffect(() => {
    if (!hydrated) return;
    let current = true;
    const revision = ++autoRevision.current;
    setStatus("saving");
    void persist(ui, () => revision === autoRevision.current).then(
      () => {
        if (current) setStatus("saved");
      },
      () => {
        if (current) {
          setStatus("failed");
          onError(failureMessageRef.current);
        }
      }
    );
    return () => {
      current = false;
    };
  }, [ui, hydrated, retry, persist, onError]);

  return { status, persist, retry: () => setRetry((value) => value + 1) };
}
