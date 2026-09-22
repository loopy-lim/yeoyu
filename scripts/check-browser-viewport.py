"""Run the production site-settings binding with SDK settings as a recording port.

This catches selecting a forced desktop viewport while saving site preferences.
It does not simulate CSS layout or replace the responsive-viewport.html engine test.
"""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class BrowserViewportTest(unittest.TestCase):
    def test_site_settings_preserve_responsive_viewport(self):
        source = (ROOT / 'android/app/src/main/java/dev/browser/GeckoSessionRegistry.kt').read_text()
        start = source.index('    private fun applySiteSettings(')
        end = source.index('\n    private fun ', start + 1)
        method = source[start:end]
        # Execute the complete method unchanged; record only the external SDK port.
        adapter = '''
package dev.browser
object GeckoSessionSettings {
    const val USER_AGENT_MODE_MOBILE = 0
    const val USER_AGENT_MODE_DESKTOP = 1
    const val VIEWPORT_MODE_MOBILE = 0
    const val VIEWPORT_MODE_DESKTOP = 1
}
class Settings {
    var userAgentMode = -1
    var viewportMode = -1
    var useTrackingProtection = false
}
class Session { val settings = Settings() }
class Entry { val session = Session() }
internal class Binding(var toolsConfig: BrowserToolsConfig) {
METHOD
    fun apply(entry: Entry) = applySiteSettings(entry, "https://example.com/article")
}
fun main() {
    val binding = Binding(BrowserToolsConfig())
    val entry = Entry()
    binding.apply(entry)
    val settings = entry.session.settings
    check(settings.viewportMode == 0 && settings.userAgentMode == 1)
    check(settings.useTrackingProtection)
    // An unrelated protection or keep-alive change creates a desktop=true site
    // record. That must not change how its responsive document is laid out.
    for (site in listOf(
        BrowserSiteConfig("https://example.com", true, false),
        BrowserSiteConfig("https://example.com", true, null, true),
        BrowserSiteConfig("https://example.com", true, null),
        BrowserSiteConfig("https://example.com", false, null),
    )) {
        binding.toolsConfig = BrowserToolsConfig(sites = listOf(site))
        binding.apply(entry)
        check(settings.viewportMode == 0) {
            "Responsive viewport lost after saving $site: viewportMode=${settings.viewportMode} (forced desktop)"
        }
        check(settings.userAgentMode == if (site.desktop) 1 else 0)
        check(settings.useTrackingProtection == (site.trackingProtection ?: true))
    }
    // Navigating out of a mobile override must restore desktop UA, retain
    // responsive layout, and respect the global protection setting.
    binding.toolsConfig = BrowserToolsConfig(trackingProtection = "engine-default")
    binding.apply(entry)
    check(settings.viewportMode == 0 && settings.userAgentMode == 1)
    check(!settings.useTrackingProtection)
    println("PASS: default, protection, keep-alive, desktop/mobile and navigation viewport binding")
}
'''.replace('METHOD', method)
        cache = Path(os.environ.get('GRADLE_USER_HOME', Path.home() / '.gradle')) / 'caches/modules-2/files-2.1'

        def jar(group, name, version):
            return str(next((cache / group / name / version).glob('*/*.jar')))

        stdlib = jar('org.jetbrains.kotlin', 'kotlin-stdlib', '2.4.10')
        annotations = jar('org.jetbrains', 'annotations', '23.0.0')
        compiler = ':'.join([
            jar('org.jetbrains.kotlin', 'kotlin-compiler-embeddable', '2.4.10'), stdlib, annotations,
            jar('org.jetbrains.kotlinx', 'kotlinx-coroutines-core-jvm', '1.10.2'),
            jar('org.jetbrains.kotlin', 'kotlin-reflect', '2.0.21'),
        ])
        classpath = ':'.join([stdlib, annotations, jar('org.json', 'json', '20250517')])
        with tempfile.TemporaryDirectory(prefix='yeoyu-viewport-') as temp:
            work = Path(temp)
            (work / 'Adapter.kt').write_text(adapter)
            compiled = subprocess.run([
                'java', '-cp', compiler, 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler',
                '-no-stdlib', '-no-reflect', '-classpath', classpath, '-d', str(work / 'classes'),
                str(work / 'Adapter.kt'),
                str(ROOT / 'android/app/src/main/java/dev/browser/BrowserToolsConfig.kt'),
            ], text=True, capture_output=True)
            self.assertEqual(compiled.returncode, 0, compiled.stdout + compiled.stderr)
            run = subprocess.run([
                'java', '-cp', str(work / 'classes') + ':' + classpath, 'dev.browser.AdapterKt',
            ], text=True, capture_output=True)
            self.assertEqual(run.returncode, 0, run.stdout + run.stderr)


if __name__ == '__main__':
    unittest.main()
