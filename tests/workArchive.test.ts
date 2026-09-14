import { describe, expect, test } from "bun:test";
import { bookmarkHtmlToArchive, bookmarksToHtml, portablePresentation, parsePresentation } from "../src/workArchive";
import { defaultUiPreferences } from "../src/uiPreferences";

describe("portable bookmarks", () => {
  test("imports nested Netscape folders, Korean text and entities without executing markup", () => {
    const archive = JSON.parse(bookmarkHtmlToArchive(`<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p>
      <DT><H3>공부 &amp; 읽기</H3><DL><DT><H3>웹</H3><DL>
      <DT><A HREF="https://example.com/?a=1&amp;b=2">자료 &#x1F680;</A></DL></DL>
      <DT><A HREF='https://example.com/'>중복</A><DT><A HREF=https://example.com/>중복</A>
      <script><A HREF="https://hidden.example/">hidden</A></script></DL>`));
    expect(archive.spaces[0].name).toBe("Imported Space");
    expect(archive.spaces[0].folders.map((f: {title: string}) => f.title)).toEqual(["공부 & 읽기", "공부 & 읽기 / 웹"]);
    expect(archive.spaces[0].bookmarks).toEqual([
      { title: "자료 🚀", url: "https://example.com/?a=1&b=2", folderIndex: 1 },
      { title: "중복", url: "https://example.com/", folderIndex: null },
      { title: "중복", url: "https://example.com/", folderIndex: null },
    ]);
    expect(archive.spaces[0].tabs).toEqual([]);
  });
  test("rejects active schemes, corrupt input and oversized input as a whole", () => {
    for (const html of ["plain text", "<DL><A HREF='javascript:alert(1)'>bad</A></DL>", "<DL><A HREF='https://ok/'>ok</A><A HREF='data:text/html,x'>bad</A></DL>", "<DL><A HREF='https://ok/'>unfinished</DL>", "x".repeat(8 * 1024 * 1024 + 1)])
      expect(() => bookmarkHtmlToArchive(html)).toThrow();
  });
  test("exports escaped text and round-trips duplicate bookmarks and empty folders", () => {
    const archive = { format: "yeoyu-work", version: 1, spaces: [{ name: "한글", color: "", tabs: [], folders: [{title: "A < B"}, {title: "비어 있음"}], bookmarks: [{title: '<img src=x> & "제목"', url: 'https://example.com/?x="&y=2', folderIndex: 0}, {title: "duplicate", url: "https://example.com/", folderIndex: null}]}], keyBindings: [], presentation: null };
    const html = bookmarksToHtml(JSON.stringify(archive));
    expect(html).not.toContain("<img src=x>");
    const result = JSON.parse(bookmarkHtmlToArchive(html));
    expect(result.spaces[0].bookmarks.map((b: {title:string}) => b.title)).toContain('<img src=x> & "제목"');
    expect(result.spaces[0].folders.map((f: {title:string}) => f.title)).toContain("한글 / 비어 있음");
  });
});

test("presentation archive excludes site rules, boosts and account settings", () => {
  const raw = portablePresentation({ ...defaultUiPreferences, boosts: [{host: "private-canary.example", css: "secret", enabled: true}] });
  expect(raw).not.toContain("canary");
  expect(raw).not.toContain("boosts");
  expect(parsePresentation(raw)?.appearance).toBe("lavender");
  expect(parsePresentation(null)).toBeNull();
  expect(() => parsePresentation('{"schema":2}')).toThrow();
  expect(() => parsePresentation(raw.replace('"sidebarWidth":240', '"sidebarWidth":9999'))).toThrow();
});

test("portable HTML rejects malformed authorities and credentials atomically", () => {
  for (const address of ["https://:", "https://@", "https://example.com:invalid", "https://example.com:65536", "https://[::1", "https://user@example.com", "https://user:pass@example.com", "https://:pass@example.com", "https://example.com/\u0085x", "https://example.com/\u2003x"])
    expect(() => bookmarkHtmlToArchive(`<DL><A HREF="https://ok.example/">ok</A><A HREF="${address}">bad</A></DL>`)).toThrow();
});
test("portable HTML preserves supported addresses through an archive roundtrip", () => {
  for (const address of ["HTTPS://example.com/", "https://한글.example/경로", "http://[::1]:8080/a", "https://example.com:443/a"]) {
    const archive = bookmarkHtmlToArchive(`<DL><A HREF="${address}">valid</A></DL>`);
    const roundtrip = JSON.parse(bookmarkHtmlToArchive(bookmarksToHtml(archive)));
    expect(roundtrip.spaces[0].bookmarks[0].url).toBe(address);
  }
});
