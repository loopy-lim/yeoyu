import { expect, test } from "bun:test";
import { normalizeInput, suggest } from "../src/suggestions";
import { matchingCommands } from "../src/commandRegistry";

test("addresses with ports and IPv6 are navigated instead of treated as schemes or searches", () => {
  for (const [input, expected] of [
    ["localhost:8080/Docs?q=A", "https://localhost:8080/Docs?q=A"],
    ["example.com:8443/path", "https://example.com:8443/path"],
    ["[::1]:8080/path", "https://[::1]:8080/path"],
    ["localhost", "https://localhost/"],
    ["http://localhost:8080/path", "http://localhost:8080/path"],
    ["mailto:hello@example.com", "mailto:hello@example.com"],
    ["tel:12345", "tel:12345"],
    ["sms:5551234", "sms:5551234"],
    ["geo:37", "geo:37"],
  ])
    expect(normalizeInput(input!, "google")).toBe(expected!);
  expect(normalizeInput("meeting at 10:30", "google")).toBe(
    "https://www.google.com/search?q=meeting%20at%2010%3A30"
  );
});

test("an open tab wins over a duplicate visited link and keeps its identity", () => {
  const rows = suggest("example", {
    favorites: [],
    bookmarks: [],
    tabs: [{ id: "open-1", url: "https://example.com/", title: "Example" }],
    history: [{ url: "https://example.com/", title: "Example", at: 100 }],
  });
  expect(rows).toEqual([
    {
      url: "https://example.com/",
      title: "Example",
      source: "tab",
      tabId: "open-1",
    },
  ]);
});

test("command search matches product words in any order without exposing IDs", () => {
  const pin = {
    id: "pins.toggle",
    title: "Pin or unpin tab",
    keywords: "save bookmark space",
  };
  expect(matchingCommands("pin tab", [pin])).toEqual([pin]);
  expect(matchingCommands("pins.toggle", [pin])).toEqual([]);
  expect(matchingCommands("", [pin])).toEqual([]);
});
