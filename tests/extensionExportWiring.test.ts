import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(import.meta.dir,
  '../android/app/src/main/java/dev/browser/BrowserExtensionViews.kt'), 'utf8');

test('top-level and dashboard iframe export callbacks share the principal gate', () => {
  // Kotlin policy tests exercise the owner, scheme and redirect decisions. This
  // bridge check covers the regression where only the top-level delegate used it.
  for (const callback of ['onLoadRequest', 'onSubframeLoadRequest']) {
    const body = source.match(new RegExp(`override fun ${callback}\\([^\\n]+\\{([\\s\\S]*?)\\n            \\}`))?.[1];
    expect(body).toBeDefined();
    expect(body).toContain('val allowed = allowsNavigation(panel, session, request)');
    expect(body).toContain('if (allowed) AllowOrDeny.ALLOW else AllowOrDeny.DENY');
  }
  const gate = source.slice(source.indexOf('    private fun allowsNavigation('), source.indexOf('    private fun export('));
  expect(gate).toContain('panels[session] === panel');
  expect(gate).toContain('BrowserExtensionHost.allowsPanelExport(panel.extensionId, session)');
  expect(gate).toContain('BrowserExtensionDownloads.allowedNavigation(panel.origin.toString(), request.triggerUri, request.uri, request.isRedirect)');
});
