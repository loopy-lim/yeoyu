package dev.browser

import org.junit.Assert.assertEquals
import org.junit.Test

class NavigationTargetUrlTest {
    private val known = "https://previous.example/article"

    @Test fun errorNavigationKeepsTheRequestedHttpUrlAsTheFutureRestoreTarget() {
        val original = "http://127.0.0.1:8877/system-pip.html?run=external-5b5a"
        val reported = "about:neterror?e=netReset&u=http%3A//127.0.0.1%3A8877/system-pip.html%3Frun%3Dexternal-5b5a&c=UTF-8"
        assertEquals(original, navigationTargetUrl(reported, known))
        // Once stored, reopening the target must remain an ordinary network load.
        assertEquals(original, navigationTargetUrl(original, known))
    }

    @Test fun certificateErrorsPreserveTheOriginalHttpsTarget() {
        assertEquals("https://example.test/secure", navigationTargetUrl(
            "about:certerror?e=nssBadCert&u=https%3A%2F%2Fexample.test%2Fsecure", known))
        assertEquals("https://example.test/secure", navigationTargetUrl(
            "about:neterror?e=nssBadCert&u=https%3A%2F%2Fexample.test%2Fsecure", known))
    }

    @Test fun theOriginalQueryFragmentAndEscapedPathAreDecodedExactlyOnce() {
        assertEquals("https://example.test/a%2Fb?q=a+b&next=%23value#section", navigationTargetUrl(
            "about:neterror?u=https%3A%2F%2Fexample.test%2Fa%252Fb%3Fq%3Da%2Bb%26next%3D%2523value%23section&e=netReset#internal", known))
        assertEquals("https://example.test/?q=a+b", navigationTargetUrl(
            "about:neterror?u=https://example.test/?q=a+b", known))
    }

    @Test fun normalRedirectsAndLegitimateAboutPagesRemainUnchanged() {
        for (url in listOf("https://redirect.example/final?from=one#two", "about:blank", "about:config",
                "https://example.test/about:neterror?u=ignored", "about:neterror-extra?u=ignored")) {
            assertEquals(url, navigationTargetUrl(url, known))
        }
        assertEquals(known, navigationTargetUrl(null, known))
    }

    @Test fun missingAmbiguousAndMalformedOriginalUrlsDoNotReplaceTheKnownTarget() {
        for (reported in listOf("about:neterror", "about:neterror?e=netReset", "about:neterror?u=",
                "about:neterror?u=https://one.test&u=https://two.test", "about:neterror?u=%",
                "about:neterror?u=https%3A%2F%2Fexample.test%2F%GG", "about:neterror?u=https%3A%2F%2Fexample.test%2F%FF",
                "about:neterror?u=https%3A%2F%2Fexample.test%2F%00")) {
            assertEquals(reported, known, navigationTargetUrl(reported, known))
        }
        assertEquals("about:blank", navigationTargetUrl("about:neterror?u=bad", "about:blank"))
    }

    @Test fun anErrorPageCannotPromoteANonHttpOrHostlessTarget() {
        for (target in listOf("javascript%3Aalert(1)", "data%3Atext%2Fhtml%2Cerror", "file%3A%2F%2F%2Fprivate",
                "about%3Ablank", "%2Frelative", "https%3Aopaque", "http%3A%2F%2F", "https%3A%2F%2Fexample.test%3Ainvalid")) {
            assertEquals(target, known, navigationTargetUrl("about:neterror?u=$target", known))
        }
    }

    @Test fun escapedUnicodeAndIpv6LocalTargetsRemainUsable() {
        assertEquals("http://[::1]:8877/시험?q=값", navigationTargetUrl(
            "about:neterror?u=http%3A%2F%2F%5B%3A%3A1%5D%3A8877%2F%EC%8B%9C%ED%97%98%3Fq%3D%EA%B0%92", known))
    }
}
