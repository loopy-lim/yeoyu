import {
  permissionKindsFromEvent,
  type PermissionDecision,
} from "./permissions";
import { PERMISSION_LABELS, type PermissionKind } from "./uiPreferences";

export interface PermissionRequest {
  requestId: number;
  tabId: string;
  kind: string;
  origin: string;
  ephemeral?: boolean;
}
export type PermissionChoice = "once" | "always" | "block" | "dismiss";

/** Gecko 155 remembers content grants; only media callbacks grant one request. */
export function permissionSupportsOnce(kinds: readonly string[]): boolean {
  return (
    kinds.length > 0 &&
    kinds.every((kind) => kind === "camera" || kind === "microphone")
  );
}

/** Native events can arrive before React renders. Own their order synchronously,
 * including the Android dialog and disk write after the web dialog closes. */
export class PermissionRequests {
  private requests: PermissionRequest[] = [];
  private processing: number | null = null;
  private listeners = new Set<() => void>();
  getSnapshot = (): PermissionRequest | null =>
    this.processing === null ? this.requests[0] ?? null : null;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private changed() {
    this.listeners.forEach((listener) => listener());
  }
  has(id: number) {
    return this.requests.some((request) => request.requestId === id);
  }
  enqueue(request: PermissionRequest) {
    if (this.has(request.requestId) || this.processing === request.requestId)
      return;
    this.requests.push(request);
    this.changed();
  }
  begin(id: number): PermissionRequest | null {
    const request = this.getSnapshot();
    if (!request || request.requestId !== id) return null;
    this.processing = id;
    this.changed();
    return request;
  }
  cancel(id: number) {
    this.requests = this.requests.filter((request) => request.requestId !== id);
    // An OS dialog may still be open: keep its serialization slot until finish.
    this.changed();
  }
  finish(id: number) {
    if (this.processing !== id) return;
    this.processing = null;
    this.cancel(id);
  }
  cancelAll(): number[] {
    const ids = this.requests.map((request) => request.requestId);
    this.requests = [];
    this.changed();
    return ids;
  }

  /** Reuse a durable choice for requests that arrived while its dialog was open. */
  takeDecided(
    origin: string,
    kinds: PermissionKind[],
    decision: PermissionDecision
  ): number[] {
    const decidedKinds = new Set(kinds);
    const ids = this.requests
      .filter((request) => {
        if (
          request.requestId === this.processing ||
          request.ephemeral ||
          request.origin !== origin
        )
          return false;
        const wanted = permissionKindsFromEvent(request.kind);
        if (!wanted.length || wanted.length !== request.kind.split(",").length)
          return false;
        return decision === "allow"
          ? wanted.every((kind) => decidedKinds.has(kind))
          : wanted.some((kind) => decidedKinds.has(kind));
      })
      .map((request) => request.requestId);
    const resolvedIds = new Set(ids);
    this.requests = this.requests.filter(
      (request) => !resolvedIds.has(request.requestId)
    );
    return ids;
  }
}

interface PermissionAnswers {
  requestAndroid(kind: PermissionKind): Promise<boolean>;
  save(
    origin: string,
    kinds: PermissionKind[],
    decision: PermissionDecision
  ): Promise<void>;
  resolve(id: number, allow: boolean, rememberDenial: boolean): void;
}

export async function answerPermission(
  queue: PermissionRequests,
  id: number,
  choice: PermissionChoice,
  ports: PermissionAnswers
): Promise<void> {
  const request = queue.begin(id);
  if (!request) return;
  let allow = false;
  let rememberDenial = false;
  let saved: {
    origin: string;
    kinds: PermissionKind[];
    decision: PermissionDecision;
  } | null = null;
  try {
    const kinds = permissionKindsFromEvent(request.kind);
    if (
      !kinds.length ||
      kinds.length !== request.kind.split(",").length ||
      choice === "dismiss"
    )
      return;
    if (choice === "once" && !permissionSupportsOnce(kinds))
      throw new Error(
        "This permission cannot be allowed just once. Choose the site's remembered Allow option."
      );
    if (choice !== "block") {
      for (const kind of kinds) {
        if (!queue.has(id)) return;
        const granted = await ports.requestAndroid(kind);
        if (!queue.has(id)) return;
        if (!granted)
          throw new Error(
            `${PERMISSION_LABELS[kind]} needs the Android permission`
          );
      }
    }
    if (choice !== "once" && !request.ephemeral) {
      if (!queue.has(id)) return;
      // One explicit site decision is one disk transaction for all channels.
      // Once saving starts, Always/Block remains an origin-scoped choice even
      // if navigation follows; the retired document's request is still denied.
      await ports.save(
        request.origin,
        kinds,
        choice === "block" ? "block" : "allow"
      );
      saved = {
        origin: request.origin,
        kinds,
        decision: choice === "block" ? "block" : "allow",
      };
    }
    allow = choice !== "block" && queue.has(id);
    rememberDenial = choice === "block" && queue.has(id);
  } finally {
    try {
      ports.resolve(id, allow, rememberDenial);
      if (saved) {
        for (const pendingId of queue.takeDecided(
          saved.origin,
          saved.kinds,
          saved.decision
        )) {
          ports.resolve(
            pendingId,
            saved.decision === "allow",
            saved.decision === "block"
          );
        }
      }
    } finally {
      queue.finish(id);
    }
  }
}
