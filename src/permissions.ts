import { PERMISSION_KINDS, type PermissionKind } from "./uiPreferences";

// Per-site permission decisions. There is deliberately no global grant: a
// site gets access only through a rule stored here (or a one-time dialog
// answer), so approving one site never leaks to another.
export type PermissionDecision = "allow" | "block";

export interface SitePermission {
  origin: string;
  kind: PermissionKind;
  decision: PermissionDecision;
  at: number;
}

const STORAGE_KEY = "rules";
const ORIGIN_FORMAT = 2;

interface PermissionStorage {
  readSitePermissions?: () => Promise<string | null>;
  saveSitePermissions?: (json: string) => Promise<void>;
}

// Storage is injected so this module stays importable outside react-native
// (bun tests); the app wires the real native platform in App.tsx.
export class SitePermissions {
  private rules: SitePermission[] = [];
  private loadPromise: Promise<void> | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private storage: PermissionStorage) {}

  // Mutations queue behind load so a request resolved during startup cannot
  // be overwritten when the persisted rules arrive.
  load(): Promise<void> {
    if (!this.loadPromise) {
      const read = this.storage.readSitePermissions;
      this.loadPromise = (
        typeof read === "function" ? read() : Promise.resolve(null)
      )
        .then((json) => {
          this.rules = readPersistedPermissions(json);
        })
        .catch((error) => {
          this.loadPromise = null;
          throw error;
        });
    }
    return this.loadPromise;
  }

  decisionFor(origin: string, kind: PermissionKind): PermissionDecision | null {
    return (
      this.rules.find((rule) => rule.origin === origin && rule.kind === kind)
        ?.decision ?? null
    );
  }

  all(): SitePermission[] {
    return [...this.rules];
  }

  async decide(
    origin: string,
    kind: PermissionKind,
    decision: PermissionDecision
  ) {
    await this.decideMany(origin, [kind], decision);
  }

  async decideMany(
    origin: string,
    kinds: PermissionKind[],
    decision: PermissionDecision
  ) {
    await this.load();
    await this.mutate((rules) => [
      ...[...new Set(kinds)].map((kind) => ({
        origin,
        kind,
        decision,
        at: Date.now(),
      })),
      ...rules.filter(
        (rule) => !(rule.origin === origin && kinds.includes(rule.kind))
      ),
    ]);
  }

  async revoke(origin: string, kind: PermissionKind) {
    await this.load();
    await this.mutate((rules) =>
      rules.filter((rule) => !(rule.origin === origin && rule.kind === kind))
    );
  }

  async clearAll() {
    await this.load();
    await this.mutate(() => []);
  }

  private mutate(update: (rules: SitePermission[]) => SitePermission[]) {
    const operation = this.mutationQueue.then(async () => {
      const nextRules = update(this.rules);
      await this.persist(nextRules);
      this.rules = nextRules;
    });
    this.mutationQueue = operation.catch(() => undefined);
    return operation;
  }

  private persist(rules: SitePermission[]): Promise<void> {
    const save = this.storage.saveSitePermissions;
    if (typeof save !== "function") return Promise.resolve();
    const json = JSON.stringify({
      originFormat: ORIGIN_FORMAT,
      [STORAGE_KEY]: rules,
    });
    return save(json);
  }
}

// Media requests can carry both channels as one native event ("camera,microphone").
export function permissionKindsFromEvent(kind: string): PermissionKind[] {
  return kind
    .split(",")
    .filter((raw): raw is PermissionKind =>
      (PERMISSION_KINDS as string[]).includes(raw)
    );
}

export function readPersistedPermissions(
  json: string | null
): SitePermission[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    const currentOriginFormat =
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as Record<string, unknown>).originFormat === ORIGIN_FORMAT;
    const entries =
      typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)[STORAGE_KEY]
        : parsed;
    if (!Array.isArray(entries)) return [];
    const rules: SitePermission[] = [];
    const seen = new Set<string>();
    for (const entry of entries) {
      const record = entry as Partial<SitePermission> | null;
      if (typeof record?.origin !== "string" || !record.origin) continue;
      if (
        typeof record.kind !== "string" ||
        !(PERMISSION_KINDS as string[]).includes(record.kind)
      )
        continue;
      if (record.decision !== "allow" && record.decision !== "block") continue;
      // Old native code discarded www. and ports. The actual origin that
      // earned a legacy grant cannot be recovered, so ask again; blocks
      // remain in place. New grants persist with the full-origin format.
      if (!currentOriginFormat && record.decision === "allow") continue;
      const key = `${record.origin}|${record.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rules.push({
        origin: record.origin,
        kind: record.kind,
        decision: record.decision,
        at: typeof record.at === "number" ? record.at : 0,
      });
    }
    return rules;
  } catch {
    return [];
  }
}
