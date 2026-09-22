import { expect, test } from "bun:test";
import { parseDownloadHistoryStatus } from "../src/downloadHistory";

test("only an explicitly resettable damaged history exposes destructive recovery", () => {
  expect(parseDownloadHistoryStatus('{"state":"damaged","message":"History damaged","canReset":true}').canReset).toBe(true);
  for (const state of ["ready", "unsupported", "unavailable"])
    expect(parseDownloadHistoryStatus(JSON.stringify({ state, message: "Keep history", canReset: true })).canReset).toBe(false);
  expect(parseDownloadHistoryStatus('{"state":"damaged","message":"History damaged"}').canReset).toBe(false);
});

test("status retains recovery guidance and the verified backup receipt", () => {
  expect(parseDownloadHistoryStatus('{"state":"ready","message":"Files kept","backupName":"downloads.damaged-123"}')).toEqual({
    state: "ready", message: "Files kept", canReset: false, backupName: "downloads.damaged-123",
  });
});

test("unknown or malformed status fails visibly instead of enabling reset", () => {
  for (const value of ["broken", "null", "[]", '{"state":"future","message":"x","canReset":true}', '{"state":"damaged"}'])
    expect(() => parseDownloadHistoryStatus(value)).toThrow();
});
