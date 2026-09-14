import { expect, test } from "bun:test";
import { registerSurfaceRef } from "../src/surfaceRefs";

test("retiring surface cleanup cannot remove the new session owner", () => {
  const refs = new Map<string, object>();
  const old = {};
  const current = {};
  const retire = registerSurfaceRef(refs, "tab", old);
  const close = registerSurfaceRef(refs, "tab", current);
  retire();
  expect(refs.get("tab")).toBe(current);
  close();
  expect(refs.has("tab")).toBe(false);
});
