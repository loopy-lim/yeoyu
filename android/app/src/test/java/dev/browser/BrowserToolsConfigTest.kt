package dev.browser

import org.junit.Assert.*
import org.junit.Test

class BrowserToolsConfigTest {
    @Test fun newInstallsWithoutAStoredChoiceGetStandardProtection() {
        assertEquals("standard", BrowserToolsConfig().trackingProtection)
    }

    @Test fun restoresNothingUnlessTheUserExplicitlyOptsIn() {
        val config = BrowserToolsConfig.parse("""{"schema":1,"restoreSessions":false,"trackingProtection":"engine-default","textScale":1,"sites":[]}""")
        assertFalse(config.restoreSessions)
        assertFalse(config.automaticMemorySaving)
        assertTrue(config.siteFor("https://example.com") == null)
    }

    @Test fun siteRulesMatchOnlyTheSameCanonicalOrigin() {
        val config = BrowserToolsConfig.parse("""{"schema":1,"restoreSessions":true,"trackingProtection":"standard","textScale":1.2,"sites":[{"origin":"https://EXAMPLE.com:443","desktop":false,"trackingProtection":false}]}""")
        assertEquals(false, config.siteFor("https://example.com/path")?.desktop)
        assertEquals(false, config.siteFor("https://example.com/path")?.trackingProtection)
        assertNull(config.siteFor("http://example.com/path"))
        assertNull(config.siteFor("https://example.com:8443"))
        assertNull(config.siteFor("https://other.example.com"))
        assertEquals(1.2, BrowserToolsConfig.parse(config.toJson()).textScale, 0.001)
    }

    @Test fun automaticMemorySavingAndKeepAliveRequireExplicitBooleans() {
        val config = BrowserToolsConfig(automaticMemorySaving = true, sites = listOf(BrowserSiteConfig("https://example.com", true, null, true)))
        val read = BrowserToolsConfig.parse(config.toJson())
        assertTrue(read.automaticMemorySaving)
        assertTrue(read.siteFor("https://example.com/path")!!.keepAlive)
        assertThrows(IllegalArgumentException::class.java) { BrowserToolsConfig.parse(config.toJson().replace("\"automaticMemorySaving\":true", "\"automaticMemorySaving\":\"true\"")) }
    }

    @Test fun defaultSiteRowsAreRemovedWithoutDroppingExplicitOverrides() {
        val config = BrowserToolsConfig.parse("""{"schema":1,"restoreSessions":false,"trackingProtection":"standard","textScale":1,"sites":[{"origin":"https://default.example","desktop":true,"trackingProtection":null,"keepAlive":false},{"origin":"https://kept.example","desktop":true,"trackingProtection":true}]}""")
        assertEquals(1, config.sites.size)
        assertNull(config.siteFor("https://default.example"))
        assertEquals(true, config.siteFor("https://kept.example")?.trackingProtection)
    }

    @Test fun duplicateOriginsRemainInvalidEvenWhenOneRowContainsOnlyDefaults() {
        assertThrows(IllegalArgumentException::class.java) {
            BrowserToolsConfig.parse("""{"schema":1,"restoreSessions":false,"trackingProtection":"standard","textScale":1,"sites":[{"origin":"https://example.com","desktop":true,"trackingProtection":null},{"origin":"https://example.com:443","desktop":false,"trackingProtection":null}]}""")
        }
    }

    @Test fun malformedOrOverBroadConfigurationIsRejectedWithoutDefaults() {
        val bad = listOf(
            "{}",
            """{"schema":2,"restoreSessions":false,"trackingProtection":"standard","textScale":1,"sites":[]}""",
            """{"schema":1,"restoreSessions":"false","trackingProtection":"standard","textScale":1,"sites":[]}""",
            """{"schema":1,"restoreSessions":false,"trackingProtection":"off","textScale":1,"sites":[]}""",
            """{"schema":1,"restoreSessions":false,"trackingProtection":"standard","textScale":99,"sites":[]}""",
            """{"schema":1,"restoreSessions":false,"trackingProtection":"standard","textScale":1,"sites":[{"origin":"https://example.com/path","desktop":true,"trackingProtection":null}]}""",
            """{"schema":1,"restoreSessions":false,"trackingProtection":"standard","textScale":1,"sites":[{"origin":"javascript:alert(1)","desktop":true,"trackingProtection":null}]}""",
        )
        bad.forEach { assertThrows(IllegalArgumentException::class.java) { BrowserToolsConfig.parse(it) } }
    }
}
