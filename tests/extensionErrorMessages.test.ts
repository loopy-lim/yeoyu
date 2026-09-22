import { expect, test } from "bun:test";

test("reachable native extension errors are localized, unknown ones pass through", async () => {
  // Child-process probe: browserExtensions imports react-native.
  const probe = `
    import { mock } from 'bun:test';
    mock.module('react-native', () => ({ NativeModules: {}, Platform: { OS: 'android', Version: 35 } }));
    const { localizeExtensionError } = await import('./src/browserExtensions');
    const out = {
      unreachableKo: localizeExtensionError('Could not contact Mozilla Add-ons. Check your connection and try again.', 'ko'),
      unreachableEn: localizeExtensionError('Could not contact Mozilla Add-ons. Check your connection and try again.', 'en'),
      httpKo: localizeExtensionError('Mozilla Add-ons returned HTTP 503. Try again later.', 'ko'),
      busyKo: localizeExtensionError('Another extension operation is still running', 'ko'),
      pastedLinkKo: localizeExtensionError('Paste a Mozilla Add-ons extension page link. Direct files and other stores are not supported.', 'ko'),
      unknown: localizeExtensionError('Some future native message', 'ko'),
    };
    console.log(JSON.stringify(out));
  `;
  const child = Bun.spawn([process.execPath, "-e", probe], {
    cwd: new URL("..", import.meta.url).pathname,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(err).toBe("");
  expect(code).toBe(0);
  const result = JSON.parse(out.trim());
  expect(result.unreachableKo).toBe(
    "Mozilla Add-ons에 연결할 수 없습니다. 연결을 확인하고 다시 시도하세요."
  );
  expect(result.unreachableEn).toBe(
    "Could not contact Mozilla Add-ons. Check your connection and try again."
  );
  expect(result.httpKo).toBe("Mozilla Add-ons가 HTTP 503 응답을 반환했습니다. 나중에 다시 시도하세요.");
  expect(result.busyKo).toBe("다른 확장 작업이 진행 중입니다. 끝난 뒤에 시도하세요.");
  expect(result.pastedLinkKo).toContain("Mozilla Add-ons 확장 페이지 링크를 붙여넣으세요");
  expect(result.unknown).toBe("Some future native message");
});
