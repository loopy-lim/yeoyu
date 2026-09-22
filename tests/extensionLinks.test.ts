import { expect, test } from "bun:test";
import { mozillaExtensionSource } from "../src/extensionLinks";

test.each([
  [
    "https://addons.mozilla.org/firefox/addon/example-addon",
    "https://addons.mozilla.org/firefox/addon/example-addon/",
  ],
  [
    "https://addons.mozilla.org:443/en-US/android/addon/example-addon/?utm_source=share#reviews",
    "https://addons.mozilla.org/firefox/addon/example-addon/",
  ],
  [
    " https://addons.mozilla.org/ko/firefox/addon/여유~확장/ ",
    "https://addons.mozilla.org/firefox/addon/%EC%97%AC%EC%9C%A0~%ED%99%95%EC%9E%A5/",
  ],
  [
    "https://addons.mozilla.org/ko/firefox/addon/%EC%97%AC%EC%9C%A0~%ED%99%95%EC%9E%A5/",
    "https://addons.mozilla.org/firefox/addon/%EC%97%AC%EC%9C%A0~%ED%99%95%EC%9E%A5/",
  ],
])(
  "official detail link %s is canonicalized without user query data",
  (source, expected) => {
    expect(mozillaExtensionSource(source)).toBe(expected);
  }
);

test.each([
  "",
  "ublock-origin",
  "javascript:alert(1)",
  "file:///tmp/extension.xpi",
  "https://addons.mozilla.org/firefox/addon/example-addon/reviews/",
  "https://addons.mozilla.org/firefox/addon/%2e%2e/",
  "https://addons.mozilla.org/firefox/addon/%2Fother/",
  "https://addons.mozilla.org/firefox/addon/a+b/",
  "https://addons.mozilla.org/firefox/addon/%E0%A4%A/",
  "https://addons.mozilla.org/firefox/addon/123/",
  "https://addons.mozilla.org/firefox/addon/exam\nple/",
  "https://addons.mozilla.org\\@evil.example/firefox/addon/example/",
  "https://addons.mozilla.org/firefox/addon/example/?" + "a".repeat(2048),
])("unsafe or unsupported link is rejected: %s", (source) => {
  expect(() => mozillaExtensionSource(source)).toThrow();
});
