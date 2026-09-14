export type BrowserPhase = "command" | "publication" | "serialization" | "write" | "skippedWrite";
const phases: readonly BrowserPhase[] = ["command", "publication", "serialization", "write", "skippedWrite"];
interface Bucket { count: number; totalMs: number; bytes: number; recent: number[]; cursor: number }
export interface PhaseSummary { count: number; totalMs: number; bytes: number; samples: number; medianMs: number; p95Ms: number }

/** Optional host/Acceptance instrumentation. Never accepts a page identity or content. */
export class BrowserPerformance {
  enabled = false;
  private values = new Map<BrowserPhase, Bucket>();
  setEnabled(enabled: boolean) { this.enabled = enabled; this.values.clear(); }
  record(phase: BrowserPhase, elapsedMs: number, bytes = 0) {
    if (!this.enabled || !phases.includes(phase) || !Number.isFinite(elapsedMs) || elapsedMs < 0 || !Number.isFinite(bytes) || bytes < 0) return;
    const bucket = this.values.get(phase) ?? { count: 0, totalMs: 0, bytes: 0, recent: [], cursor: 0 };
    bucket.count++; bucket.totalMs += elapsedMs; bucket.bytes += bytes;
    bucket.recent[bucket.cursor] = elapsedMs;
    bucket.cursor = (bucket.cursor + 1) % 256;
    this.values.set(phase, bucket);
  }
  snapshot(): { enabled: boolean; phases: Partial<Record<BrowserPhase, PhaseSummary>> } {
    const result: Partial<Record<BrowserPhase, PhaseSummary>> = {};
    for (const [phase, b] of this.values) {
      const samples = [...b.recent].sort((a, z) => a - z);
      const percentile = (p: number) => samples[Math.max(0, Math.ceil(samples.length * p) - 1)] ?? 0;
      result[phase] = { count: b.count, totalMs: b.totalMs, bytes: b.bytes, samples: samples.length, medianMs: percentile(0.5), p95Ms: percentile(0.95) };
    }
    return { enabled: this.enabled, phases: result };
  }
}

export function utf8Bytes(value: string): number {
  let bytes = 0;
  for (const c of value) { const n = c.codePointAt(0)!; bytes += n < 0x80 ? 1 : n < 0x800 ? 2 : n < 0x10000 ? 3 : 4; }
  return bytes;
}
