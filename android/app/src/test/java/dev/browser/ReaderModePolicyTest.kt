package dev.browser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ReaderModePolicyTest {
    @Test fun validatesHexAndRgbaReaderColors() {
        assertTrue(isValidReaderColor("#f7f6f7"))
        assertTrue(isValidReaderColor("#3D3642"))
        assertTrue(isValidReaderColor("rgb(61, 54, 66)"))
        assertTrue(isValidReaderColor("rgba(61, 54, 66, 0.85)"))

        assertFalse(isValidReaderColor(""))
        assertFalse(isValidReaderColor("red"))
        assertFalse(isValidReaderColor("#fff"))
        assertFalse(isValidReaderColor("#f7f6f7; background: url(https://evil)"))
    }

    @Test fun mapsTextScaleToBoundedReaderFontSize() {
        assertEquals(18, fontSizeForTextScale(1.0))
        assertEquals(12, fontSizeForTextScale(0.5))
        assertEquals(36, fontSizeForTextScale(2.0))
        assertEquals(12, fontSizeForTextScale(0.1))
        assertEquals(36, fontSizeForTextScale(4.0))
        assertEquals(18, fontSizeForTextScale(Double.NaN))
    }

    @Test fun parsesValidReaderStyleAndRejectsMalformedPayloads() {
        val json = """
            {
              "bg": "#25212a",
              "fg": "#f3edf6",
              "muted": "#d6c9dc",
              "accent": "#c4add0",
              "border": "#4b3d54",
              "sunken": "#2d2633",
              "fontSizePx": 22,
              "readTimeFormat": "읽는 시간 {n}분"
            }
        """.trimIndent()
        val parsed = parseReaderStyle(json)
        assertNotNull(parsed)
        assertEquals("#25212a", parsed!!.bg)
        assertEquals("#c4add0", parsed.accent)
        assertEquals(22, parsed.fontSizePx)
        assertEquals("읽는 시간 {n}분", parsed.readTimeFormat)

        assertNull(parseReaderStyle("""{"bg":"expression(alert(1))","fg":"#111111","muted":"#222222","accent":"#333333","border":"#444444","sunken":"#555555","fontSizePx":18}"""))
        assertNull(parseReaderStyle("""{"bg":"#ffffff","fg":"#111111","muted":"#222222","accent":"#333333","border":"#444444","sunken":"#555555","fontSizePx":8}"""))
        assertNull(parseReaderStyle("""{"bg":"#ffffff","fg":"#111111","muted":"#222222","accent":"#333333","border":"#444444","sunken":"#555555","fontSizePx":48}"""))

        val badFormatFallback = parseReaderStyle(
            """{"bg":"#ffffff","fg":"#111111","muted":"#222222","accent":"#333333","border":"#444444","sunken":"#555555","fontSizePx":18,"readTimeFormat":"no placeholder"}"""
        )
        assertEquals("{n} min read", badFormatFallback?.readTimeFormat)
    }

    @Test fun limitsReaderEligibilityToHttpAndHttpsUrls() {
        assertTrue(isEligibleReaderUrl("https://example.com/article"))
        assertTrue(isEligibleReaderUrl("http://news.ycombinator.com/item?id=1"))
        assertFalse(isEligibleReaderUrl(null))
        assertFalse(isEligibleReaderUrl(""))
        assertFalse(isEligibleReaderUrl("about:blank"))
        assertFalse(isEligibleReaderUrl("moz-extension://id/options.html"))
        assertFalse(isEligibleReaderUrl("file:///sdcard/test.html"))
    }
}
