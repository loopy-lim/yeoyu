import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../android/app/src/main/res");
const read = (folder: string) =>
  readFileSync(resolve(root, folder, "strings.xml"), "utf8");
const entries = (xml: string) =>
  new Map(
    [...xml.matchAll(/<string name="([^"]+)">([\s\S]*?)<\/string>/g)].map(
      (match) => [match[1], match[2]]
    )
  );

test("Android app-owned strings have Korean counterparts with matching format arguments", () => {
  const english = entries(read("values"));
  const korean = entries(read("values-ko"));
  expect([...korean.keys()].sort()).toEqual([...english.keys()].sort());
  for (const [key, value] of english) {
    const parameters = (text: string) =>
      [...text.matchAll(/%\d+\$[sd]/g)].map((match) => match[0]).sort();
    expect(parameters(korean.get(key) ?? "")).toEqual(parameters(value));
  }
});
