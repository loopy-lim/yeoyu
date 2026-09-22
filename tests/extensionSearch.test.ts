import { expect, test } from "bun:test";

test("AMO search results are parsed strictly or rejected", async () => {
  // Isolate the react-native mock like urlRuntime: bun shares the module
  // registry across test files, so the probe runs in its own process.
  const probe = `
    import { mock } from 'bun:test';
    mock.module('react-native', () => ({NativeModules: {}, Platform: {OS: 'android', Version: 35}}));
    const { parseExtensionSearch, parseBrowserExtensions } = await import('./src/browserExtensions');
    const entry = (overrides = {}) => ({
      slug: 'example-addon', name: 'Example addon', summary: 'Blocks things.',
      guid: 'example@addons.test', type: 'extension', is_disabled: false,
      icon_url: 'https://addons.cdn.mozilla.net/user-media/addon_icons/0/1-64.png', ...overrides,
    });
    const parsed = parseExtensionSearch(JSON.stringify({ results: [entry()] }));
    const minimal = parseExtensionSearch(JSON.stringify({
      results: [{ slug: 'minimal', name: 'Minimal', type: 'extension' }],
    }));
    const broken = [];
    for (const payload of ['', 'not json', '[]', '{"results":{}}', '{"other":[]}']) {
      try { parseExtensionSearch(payload); broken.push(payload); } catch {}
    }
    for (const bad of [
      entry({ slug: '12345' }), entry({ slug: 'bad slug' }), entry({ name: '   ' }),
      entry({ guid: 'has space@example' }), entry({ summary: 'x'.repeat(600) }),
      entry({ icon_url: 'https://evil.example/a.png' }),
      entry({ icon_url: 'http://addons.cdn.mozilla.net/a.png' }),
      entry({ icon_url: 'https://addons.cdn.mozilla.net/' }),
      entry({ icon_url: 'https://addons.cdn.mozilla.net/a.png?v=2' }),
    ]) {
      try { parseExtensionSearch(JSON.stringify({ results: [bad] })); broken.push(bad.slug); } catch {}
    }
    try {
      parseExtensionSearch(JSON.stringify({ results: [entry(), entry({ name: 'Duplicate' })] }));
      broken.push('duplicate');
    } catch {}
    try { parseExtensionSearch('x'.repeat(1025 * 1024)); broken.push('oversized'); } catch {}
    const iconPng = 'data:image/png;base64,' + 'A'.repeat(64);
    const installed = parseBrowserExtensions(JSON.stringify({
      busy: false, catalog: [],
      extensions: [{
        id: 'a@x.test', name: 'A', version: '1', description: '', enabled: true,
        privateAllowed: false, disabledFlags: 0, hasOptions: false, hasAction: true,
        actionEnabled: true, badge: '27', badgeBackgroundColor: '#1A73E8FF',
        badgeTextColor: '#FFFFFFFF', icon: iconPng,
        permissions: [], origins: [], dataPermissions: [],
        optionalPermissions: [], optionalOrigins: [], optionalDataPermissions: [],
      }],
    }));
    for (const badState of [
      { icon: 'data:text/html;base64,AAAA' },
      { icon: 'https://addons.cdn.mozilla.net/a.png' },
      { badgeBackgroundColor: '#12345' },
      { badgeBackgroundColor: 'red' },
    ]) {
      try {
        parseBrowserExtensions(JSON.stringify({
          busy: false, catalog: [],
          extensions: [{ ...installed.extensions[0], ...badState }],
        }));
        broken.push(badState.icon ? 'icon' : 'badge');
      } catch {}
    }
    console.log(JSON.stringify({ parsed, minimal, broken, installedIcon: installed.extensions[0].icon === iconPng }));
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
  const { parsed, minimal, broken, installedIcon } = JSON.parse(out.trim());
  expect(parsed).toEqual([
    {
      slug: "example-addon",
      name: "Example addon",
      summary: "Blocks things.",
      guid: "example@addons.test",
      iconUrl: "https://addons.cdn.mozilla.net/user-media/addon_icons/0/1-64.png",
    },
  ]);
  expect(minimal).toEqual([
    { slug: "minimal", name: "Minimal", summary: "" },
  ]);
  expect(broken).toEqual([]);
  expect(installedIcon).toBe(true);
});
