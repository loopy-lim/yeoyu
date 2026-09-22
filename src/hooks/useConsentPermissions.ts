import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import {
  UNKNOWN_ANDROID_PERMISSIONS,
  parseAndroidPermissionStatus,
  type AndroidPermissionSnapshot,
  type ConsentRuntime,
} from "../consent";

/** Read-only status: opening settings never requests or grants a permission. */
export function useConsentPermissions(runtime: ConsentRuntime) {
  const [status, setStatus] = useState<AndroidPermissionSnapshot>(
    UNKNOWN_ANDROID_PERMISSIONS
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++generation.current;
    if (!runtime.getAndroidPermissionStatus) {
      setStatus(UNKNOWN_ANDROID_PERMISSIONS);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = parseAndroidPermissionStatus(
        await runtime.getAndroidPermissionStatus()
      );
      if (request === generation.current) setStatus(next);
    } catch (failure) {
      if (request === generation.current) {
        setStatus(UNKNOWN_ANDROID_PERMISSIONS);
        setError(
          failure instanceof Error
            ? failure.message
            : "Android permission status could not be read"
        );
      }
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [runtime]);

  useEffect(() => {
    void refresh();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
      else {
        // Permissions can change while the app is outside the foreground.
        generation.current++;
        setStatus(UNKNOWN_ANDROID_PERMISSIONS);
        setLoading(false);
      }
    });
    return () => {
      generation.current++;
      subscription.remove();
    };
  }, [refresh]);

  return { status, loading, error, refresh };
}
