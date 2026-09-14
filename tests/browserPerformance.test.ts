import { expect, test } from "bun:test";
import { BrowserPerformance } from "../src/browserPerformance";

test("performance collection is opt-in, bounded and aggregate-only", () => {
  const metrics = new BrowserPerformance();
  metrics.record("write", 10, 100);
  expect(metrics.snapshot().phases).toEqual({});
  metrics.setEnabled(true);
  for (let i = 0; i < 1000; i++) metrics.record("write", i, 100);
  const result = metrics.snapshot();
  expect(result.phases.write?.count).toBe(1000);
  expect(result.phases.write?.samples).toBe(256);
  expect(result.phases.write?.bytes).toBe(100000);
  expect(result.phases.write?.p95Ms).toBeGreaterThan(900);
  expect(JSON.stringify(result)).not.toMatch(/url|title|tabId/i);
  metrics.setEnabled(false);
  expect(metrics.snapshot().phases).toEqual({});
});
