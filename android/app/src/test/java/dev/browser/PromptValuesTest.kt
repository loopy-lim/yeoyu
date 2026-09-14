package dev.browser

import org.junit.Assert.*
import org.junit.Test

class PromptValuesTest {
    @Test fun nestedGroupsAndDisabledOptionsCannotBeToggled() {
        val model = ChoiceSelection(listOf(
            WebChoice("group", "Group", children = listOf(WebChoice("a", "Alpha", selected = true))),
            WebChoice("locked", "Locked", disabled = true, children = listOf(WebChoice("b", "Beta", selected = true))),
            WebChoice("separator", "", separator = true),
            WebChoice("c", "Gamma"),
        ))
        assertEquals(listOf("group", "a", "locked", "b", "separator", "c"), model.rows.map { it.id })
        assertFalse(model.toggle("group")); assertFalse(model.toggle("b")); assertFalse(model.toggle("separator"))
        assertTrue(model.toggle("c"))
        assertEquals(listOf("a", "b", "c"), model.selectedIds())
    }

    @Test fun replacementDoesNotApplyOldSelectionToReusedOptionIds() {
        val model = ChoiceSelection(listOf(WebChoice("0", "Old"), WebChoice("1", "Other")))
        model.toggle("0")
        model.replace(listOf(WebChoice("0", "New"), WebChoice("1", "Server selected", selected = true)))
        assertEquals(listOf("1"), model.selectedIds())
    }

    @Test fun calendarValuesRejectInvalidDatesAndApplyMinAndMax() {
        val date = DateTimeConstraints(WebDateKind.DATE, min = "2024-02-28", max = "2024-03-02")
        assertNull(date.error("2024-02-29"))
        assertNotNull(date.error("2023-02-29")); assertNotNull(date.error("2024-03-03"))
        assertNull(date.error(""))
        assertNull(DateTimeConstraints(WebDateKind.WEEK).error("2020-W53"))
        assertNotNull(DateTimeConstraints(WebDateKind.WEEK).error("2021-W53"))
        assertNull(DateTimeConstraints(WebDateKind.MONTH).error("2026-09"))
        assertNotNull(DateTimeConstraints(WebDateKind.MONTH).error("2026-13"))
    }

    @Test fun knownMinBaseStepPreservesSecondsAndFractionalPrecision() {
        val time = DateTimeConstraints(WebDateKind.TIME, min = "09:00:00.250", max = "10:00", step = "0.5")
        assertNull(time.error("09:00:01.750"))
        assertNotNull(time.error("09:00:01.500"))
        val date = DateTimeConstraints(WebDateKind.DATE, min = "2026-09-01", step = "2")
        assertNull(date.error("2026-09-03")); assertNotNull(date.error("2026-09-02"))
        assertNull(DateTimeConstraints(WebDateKind.TIME, step = "900").error("09:07"))
        assertNull(DateTimeConstraints(WebDateKind.TIME, min = "09:00", step = "any").error("09:00:00.123"))
    }

    @Test fun timeAllowsMillisecondsButRejectsFourFractionalDigits() {
        for (step in listOf(null, "any")) {
            val constraints = DateTimeConstraints(WebDateKind.TIME, step = step)
            assertNull(constraints.error("09:00:00.123"))
            assertNotNull(constraints.error("09:00:00.1234"))
        }
    }

    @Test fun localDateTimeAllowsMillisecondsButRejectsFourFractionalDigits() {
        for (step in listOf(null, "any")) {
            val constraints = DateTimeConstraints(WebDateKind.DATETIME_LOCAL, step = step)
            assertNull(constraints.error("2026-09-12T09:00:00.123"))
            assertNotNull(constraints.error("2026-09-12T09:00:00.1234"))
        }
    }

    @Test fun overnightTimeBoundsWrapAndLocalDateTimeDoesNotApplyTimezone() {
        val time = DateTimeConstraints(WebDateKind.TIME, min = "23:00", max = "01:00")
        assertNull(time.error("00:30")); assertNull(time.error("23:30")); assertNotNull(time.error("12:00"))
        val local = DateTimeConstraints(WebDateKind.DATETIME_LOCAL, min = "2026-03-08T02:00", max = "2026-03-08T03:00")
        assertNull(local.error("2026-03-08T02:30")); assertNotNull(local.error("2026-03-08T02:30Z"))
    }

    @Test fun colorsNormalizeHexWithoutAcceptingMalformedValues() {
        assertEquals("#aabbcc", normalizePromptColor("#AABBCC"))
        assertNull(normalizePromptColor("#12345")); assertNull(normalizePromptColor("red;anything"))
    }

    @Test fun nonFiniteStepFallsBackToHtmlDefault() {
        val constraints = DateTimeConstraints(WebDateKind.TIME, min = "09:00", step = "1e2147483647")
        assertNull(constraints.error("09:01"))
    }

    @Test fun promptReplacementAndCancellationSettleOnlyOnce() {
        val state = PromptLifecycle("original")
        assertTrue(state.replace("updated"))
        assertEquals("updated", state.take())
        assertNull(state.take()); assertFalse(state.replace("late"))
    }
}
