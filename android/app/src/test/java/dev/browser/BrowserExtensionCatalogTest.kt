package dev.browser

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class BrowserExtensionCatalogTest {
    private fun metadata(): JSONObject = JSONObject("""{
      "guid":"uBlock0@raymondhill.net","slug":"ublock-origin","type":"extension","is_disabled":false,
      "name":{"en-US":"Untrusted display name"},
      "current_version":{"version":"1.74.0","is_strict_compatibility_enabled":false,
        "compatibility":{"android":{"min":"115.0","max":"*"}},
        "file":{"id":4981431,"status":"public","is_mozilla_signed_extension":false,
          "url":"https://addons.mozilla.org/firefox/downloads/file/4981431/ublock_origin-1.74.0.xpi"}}
    }""")

    private fun parse(value: JSONObject): BrowserExtensionCandidate =
        BrowserExtensionCatalog.candidateFromMetadata("ublock-origin", value.toString())

    @Test fun catalogUsesExplicitIdentitiesAndNoDownloadUrl() {
        val entries = BrowserExtensionCatalog.entriesJson()
        assertEquals(2, entries.length())
        assertEquals("ublock-origin", entries.getJSONObject(0).getString("slug"))
        assertEquals(BrowserExtensionCatalog.UBLOCK_ID, entries.getJSONObject(0).getString("id"))
        assertFalse(entries.getJSONObject(0).has("downloadUrl"))
        assertThrows(IllegalArgumentException::class.java) {
            BrowserExtensionCatalog.resolve("https://untrusted.example/addon")
        }
    }

    @Test fun additionalEntryStillChecksItsOwnIdentityAndAndroidCompatibility() {
        val value = metadata().put("guid", BrowserExtensionCatalog.DARK_READER_ID).put("slug", "darkreader")
        val candidate = BrowserExtensionCatalog.candidateFromMetadata("darkreader", value.toString())
        assertEquals("Dark Reader", candidate.name)
        assertEquals(BrowserExtensionCatalog.DARK_READER_ID, candidate.id)
        assertThrows(IllegalArgumentException::class.java) { parse(value) }
        assertThrows(IllegalArgumentException::class.java) {
            BrowserExtensionCatalog.candidateFromMetadata("darkreader", metadata().toString())
        }
    }

    @Test fun ordinaryAmoSignaturesAreNotMistakenForMissingSignatures() {
        val result = parse(metadata())
        assertEquals(BrowserExtensionCatalog.UBLOCK_ID, result.id)
        assertEquals("uBlock Origin", result.name)
        assertEquals("1.74.0", result.version)
        assertEquals("https://addons.mozilla.org/firefox/addon/ublock-origin/", result.sourceUrl)
    }

    @Test fun disabledUnreviewedOrDifferentExtensionsCannotBecomeCandidates() {
        for (field in listOf("guid", "is_disabled")) {
            val value = metadata().put(field, if (field == "guid") "another-extension@example.com" else true)
            assertThrows(IllegalArgumentException::class.java) { parse(value) }
        }
        val value = metadata()
        value.getJSONObject("current_version").getJSONObject("file").put("status", "unreviewed")
        assertThrows(IllegalArgumentException::class.java) { parse(value) }
        assertThrows(IllegalArgumentException::class.java) { parse(metadata().put("is_disabled", "false")) }
    }

    @Test fun pinnedAndroidEngineMustFitBothDeclaredBounds() {
        val rejected = listOf("156.0" to "*", "155.1" to "*", "115.0" to "154.*", "115.0" to "155.0a1", "*" to "*", "unknown" to "*")
        for ((min, max) in rejected) {
            val value = metadata()
            value.getJSONObject("current_version").getJSONObject("compatibility").getJSONObject("android").put("min", min).put("max", max)
            assertThrows(IllegalArgumentException::class.java) { parse(value) }
        }
        val accepted = metadata()
        accepted.getJSONObject("current_version").getJSONObject("compatibility").getJSONObject("android").put("min", "155.0a1").put("max", "155.*")
        assertEquals("1.74.0", parse(accepted).version)
        accepted.getJSONObject("current_version").getJSONObject("compatibility").remove("android")
        assertThrows(IllegalArgumentException::class.java) { parse(accepted) }
    }

    @Test fun downloadMetadataCannotRedirectTheInstallerToAnUntrustedAddress() {
        val root = "https://addons.mozilla.org/firefox/downloads/file/4981431/ublock_origin-1.74.0.xpi"
        val unsafe = listOf(
            root.replace("https:", "http:"), root.replace("addons.mozilla.org", "addons.mozilla.org.evil.example"),
            root.replace("addons.mozilla.org", "user@addons.mozilla.org"), root.replace("addons.mozilla.org", "addons.mozilla.org:8443"),
            "$root?redirect=https://evil.example/a.xpi", "$root#fragment", root.replace("4981431", "1234"),
            root.replace("ublock_origin", "../ublock_origin"), root.replace("ublock_origin", "%2e%2e%2fublock_origin"),
            root.removeSuffix(".xpi"),
        )
        for (url in unsafe) {
            val value = metadata()
            value.getJSONObject("current_version").getJSONObject("file").put("url", url)
            assertThrows(IllegalArgumentException::class.java) { parse(value) }
        }
    }

    @Test fun brokenJsonAndErrorEnvelopesNeverProduceAFallbackCandidate() {
        for (json in listOf("{", "{}", "{\"detail\":\"temporarily unavailable\"}", metadata().toString() + " trailing data")) {
            assertThrows(IllegalArgumentException::class.java) {
                BrowserExtensionCatalog.candidateFromMetadata("ublock-origin", json)
            }
        }
    }

    private fun linkedMetadata() = metadata().put("slug", "example-addon").put("guid", "example@addons.test")
        .put("default_locale", "ko").put("name", JSONObject().put("ko", "예제 확장").put("en-US", "Example"))

    @Test fun officialDetailLinksResolveBeyondTheCuratedCatalogWithoutForwardingTrackingData() {
        for (link in listOf(
            "https://addons.mozilla.org/firefox/addon/example-addon/",
            " https://addons.mozilla.org/ko/android/addon/example-addon?utm_source=share#reviews ",
            "https://addons.mozilla.org:443/en-US/firefox/addon/example-addon/",
        )) {
            val result = BrowserExtensionCatalog.candidateFromMetadata(link, linkedMetadata().toString())
            assertEquals("example@addons.test", result.id)
            assertEquals("예제 확장", result.name)
            assertEquals("https://addons.mozilla.org/firefox/addon/example-addon/", result.sourceUrl)
        }
        assertEquals(BrowserExtensionCatalog.UBLOCK_ID, BrowserExtensionCatalog.candidateFromMetadata(
            "https://addons.mozilla.org/android/addon/ublock-origin/", metadata().toString()).id)
        val translated = linkedMetadata().put("slug", "여유~확장")
        assertEquals("https://addons.mozilla.org/firefox/addon/%EC%97%AC%EC%9C%A0~%ED%99%95%EC%9E%A5/",
            BrowserExtensionCatalog.candidateFromMetadata(
                "https://addons.mozilla.org/ko/firefox/addon/%EC%97%AC%EC%9C%A0~%ED%99%95%EC%9E%A5/", translated.toString()).sourceUrl)
    }

    @Test fun arbitraryLinksAndRawUnknownSlugsCannotReachMetadataResolution() {
        for (link in listOf(
            "example-addon", "", "https://evil.example/firefox/addon/example-addon/",
            "http://addons.mozilla.org/firefox/addon/example-addon/",
            "https://addons.mozilla.org.evil.example/firefox/addon/example-addon/",
            "https://user@addons.mozilla.org/firefox/addon/example-addon/",
            "https://addons.mozilla.org:8443/firefox/addon/example-addon/",
            "https://addons.mozilla.org/firefox/addon/../addon/example-addon/",
            "https://addons.mozilla.org/firefox/addon/%2fexample-addon/",
            "https://addons.mozilla.org/firefox/addon/%252fexample-addon/",
            "https://addons.mozilla.org/firefox/addon/12345/",
            "https://addons.mozilla.org/firefox/addon/example-addon/reviews/",
            "https://addons.mozilla.org/firefox/downloads/file/1/addon.xpi",
            "https://addons.mozilla.org/firefox/addon/exam\nple-addon/",
        )) assertThrows(IllegalArgumentException::class.java) {
            BrowserExtensionCatalog.candidateFromMetadata(link, linkedMetadata().toString())
        }
    }

    @Test fun linkMetadataMustMatchTheRequestedSlugAndDescribeAnIdentifiableExtension() {
        val link = "https://addons.mozilla.org/firefox/addon/example-addon/"
        for (value in listOf(
            linkedMetadata().put("slug", "different-addon"), linkedMetadata().put("type", "statictheme"),
            linkedMetadata().put("guid", ""), linkedMetadata().put("guid", "bad\nid"),
            linkedMetadata().put("name", JSONObject()), linkedMetadata().put("is_disabled", true),
        )) assertThrows(IllegalArgumentException::class.java) {
            BrowserExtensionCatalog.candidateFromMetadata(link, value.toString())
        }
        val unsupported = linkedMetadata()
        unsupported.getJSONObject("current_version").getJSONObject("compatibility").remove("android")
        assertThrows(IllegalArgumentException::class.java) {
            BrowserExtensionCatalog.candidateFromMetadata(link, unsupported.toString())
        }
        val swapped = metadata().put("guid", "example@addons.test")
        assertThrows(IllegalArgumentException::class.java) {
            BrowserExtensionCatalog.candidateFromMetadata("https://addons.mozilla.org/firefox/addon/ublock-origin/", swapped.toString())
        }
    }

    private fun searchEntry(
        slug: String = "example-addon",
        guid: String? = "example@addons.test",
        summary: String? = "Blocks things.",
        iconUrl: String? = "https://addons.cdn.mozilla.net/user-media/addon_icons/0/1-64.png",
        min: String = "115.0",
        max: String = "*",
    ): JSONObject {
        val entry = JSONObject()
            .put("slug", slug)
            .put("type", "extension")
            .put("is_disabled", false)
            .put("name", JSONObject().put("en-US", "Example addon"))
            .put("current_version", JSONObject().put(
                "compatibility", JSONObject().put("android", JSONObject().put("min", min).put("max", max))
            ))
        if (guid != null) entry.put("guid", guid)
        if (summary != null) entry.put("summary", JSONObject().put("en-US", summary))
        if (iconUrl != null) entry.put("icon_url", iconUrl)
        return entry
    }

    private fun searchEnvelope(vararg entries: JSONObject): String =
        JSONObject().put("results", JSONArray().apply { entries.forEach { put(it) } }).toString()

    @Test fun searchResultsKeepOnlyDisplayFieldsOfAndroidCompatibleExtensions() {
        val results = BrowserExtensionCatalog.searchResultsFromMetadata(searchEnvelope(searchEntry()))
        assertEquals(1, results.length())
        val entry = results.getJSONObject(0)
        assertEquals("example-addon", entry.getString("slug"))
        assertEquals("Example addon", entry.getString("name"))
        assertEquals("Blocks things.", entry.getString("summary"))
        assertEquals("example@addons.test", entry.getString("guid"))
        assertEquals("https://addons.cdn.mozilla.net/user-media/addon_icons/0/1-64.png", entry.getString("icon_url"))
        assertFalse(entry.has("current_version"))
        assertFalse(entry.has("type"))
        // A summary, guid and icon are optional.
        val minimal = BrowserExtensionCatalog.searchResultsFromMetadata(
            searchEnvelope(searchEntry(guid = null, summary = null, iconUrl = null))
        )
        assertEquals("Example addon", minimal.getJSONObject(0).getString("name"))
        assertFalse(minimal.getJSONObject(0).has("guid"))
        assertFalse(minimal.getJSONObject(0).has("icon_url"))
    }

    @Test fun searchIconAddressesMustStayOnMozillasOwnHosts() {
        // Individual entries with off-CDN icon hosts are skipped like any other
        // malformed entry; the pure validator itself is checked directly.
        for (host in listOf(
            "https://evil.example/user-media/addon_icons/0/1-64.png",
            "http://addons.cdn.mozilla.net/user-media/addon_icons/0/1-64.png",
            "https://addons.cdn.mozilla.net.evil.example/a.png",
            "https://user@addons.cdn.mozilla.net/a.png",
            "https://addons.cdn.mozilla.net/a.png?size=64",
            "https://addons.cdn.mozilla.net/",
        )) {
            val results = BrowserExtensionCatalog.searchResultsFromMetadata(
                searchEnvelope(searchEntry(slug = "bad-icon", iconUrl = host), searchEntry(slug = "kept"))
            )
            assertEquals(1, results.length())
            assertEquals("kept", results.getJSONObject(0).getString("slug"))
            assertFalse(BrowserExtensionCatalog.validIconUrl(host))
        }
        assertTrue(BrowserExtensionCatalog.validIconUrl("https://addons.mozilla.org/icon.png"))
    }

    @Test fun searchSkipsIncompatibleDisabledOrNonExtensionEntries() {
        val results = BrowserExtensionCatalog.searchResultsFromMetadata(searchEnvelope(
            searchEntry(slug = "old", min = "200.0"),
            searchEntry(slug = "beyond", max = "150.0"),
            searchEntry(slug = "no-compat").apply {
                getJSONObject("current_version").getJSONObject("compatibility").remove("android")
            },
            searchEntry(slug = "disabled").put("is_disabled", true),
            searchEntry(slug = "theme").put("type", "statictheme"),
            searchEntry(slug = "kept"),
        ))
        assertEquals(1, results.length())
        assertEquals("kept", results.getJSONObject(0).getString("slug"))
    }

    @Test fun searchSkipsMalformedEntriesButNeverReturnsADuplicateOrUnreadableEnvelope() {
        val results = BrowserExtensionCatalog.searchResultsFromMetadata(searchEnvelope(
            searchEntry(slug = "bad slug"),
            searchEntry(slug = "12345"),
            searchEntry(guid = "bad\nid"),
            searchEntry(slug = "named").put("name", JSONObject()),
            searchEntry(slug = "first"),
            searchEntry(slug = "first", guid = "other@addons.test"),
        ))
        assertEquals(1, results.length())
        assertEquals("first", results.getJSONObject(0).getString("slug"))
        for (broken in listOf("", "not json", "[]", "{\"results\":{}}", "{\"other\":[]}")) {
            assertThrows(IllegalArgumentException::class.java) {
                BrowserExtensionCatalog.searchResultsFromMetadata(broken)
            }
        }
    }

    @Test fun searchCapsResultsAtTwentyEntries() {
        val entries = (1..30).map { index -> searchEntry(slug = "addon-$index") }
        val results = BrowserExtensionCatalog.searchResultsFromMetadata(searchEnvelope(*entries.toTypedArray()))
        assertEquals(20, results.length())
    }
}
