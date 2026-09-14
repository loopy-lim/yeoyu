import { expect, test } from "bun:test";

test("bookmark identity uses the same canonical addresses under the mobile URL parser", async () => {
  // Isolate the native Blob/platform ports: the controller itself must
  // remain loadable without React Native, and no global mock leaks out.
  const probe = `
    import { mock } from 'bun:test';
    mock.module('react-native', () => ({NativeModules: {}, Platform: {OS: 'android', Version: 35}}));
    await import('react-native-url-polyfill/auto');
    const { bookmarkUrlKey } = await import('./src/BrowserController');
    console.log(JSON.stringify([
      bookmarkUrlKey('https://EXAMPLE.com'),
      bookmarkUrlKey('localhost:8080/Docs'),
      bookmarkUrlKey('https://example.com/Docs?Query=A#Part'),
      bookmarkUrlKey('http://www.example.com')
    ]));
  `;
  const child = Bun.spawn([process.execPath, "-e", probe], {
    cwd: new URL("..", import.meta.url).pathname,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(stderr).toBe("");
  expect(status).toBe(0);
  expect(JSON.parse(stdout)).toEqual([
    "https://example.com/",
    "https://localhost:8080/Docs",
    "https://example.com/Docs?Query=A#Part",
    "http://www.example.com/",
  ]);
});
