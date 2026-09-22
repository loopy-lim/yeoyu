import { expect, test } from "bun:test";
import { parseAndroidPermissionStatus } from "../src/consent";

test("Android status distinguishes approximate location from a full grant", () => {
  expect(
    parseAndroidPermissionStatus(
      JSON.stringify({
        camera: "not-allowed",
        microphone: "allowed",
        geolocation: "approximate",
        notifications: "not-allowed",
      })
    )
  ).toEqual({
    camera: "not-allowed",
    microphone: "allowed",
    geolocation: "approximate",
    notifications: "not-allowed",
  });
});

test("missing or unsupported native values never imply an Android grant", () => {
  expect(
    parseAndroidPermissionStatus('{"camera":true,"microphone":"approximate"}')
  ).toEqual({
    camera: "unknown",
    microphone: "unknown",
    geolocation: "unknown",
    notifications: "unknown",
  });
});

test("malformed native status fails visibly instead of becoming a denial", () => {
  for (const value of ["", "bad json", "null", "[]", "true"])
    expect(() => parseAndroidPermissionStatus(value)).toThrow();
});
