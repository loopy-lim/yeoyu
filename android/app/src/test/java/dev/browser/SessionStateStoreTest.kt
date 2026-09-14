package dev.browser

import java.io.File
import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class SessionStateStoreTest {
    @get:Rule val temporary = TemporaryFolder()

    private fun state(id: String = "tab-a", at: Long = 1_000, value: String = "opaque state") =
        StoredSessionState(id, "https://example.com/page", value, at)

    @Test fun writesAndRestoresOpaqueStateWithoutTreatingTabIdsAsPaths() {
        val root = temporary.newFolder()
        SessionStateStore(root, "155").write(state("../../escape", value = "본문\u0000value"), 1_000)
        val result = SessionStateStore(root, "155").readAll(1_001)
        assertEquals("본문\u0000value", result.states["../../escape"]?.state)
        assertEquals(1, root.listFiles()!!.count { it.extension == "state" })
        assertFalse(File(root.parentFile, "escape").exists())
    }

    @Test fun failedAtomicReplacementKeepsPreviousState() {
        val root = temporary.newFolder()
        val store = SessionStateStore(root, "155")
        store.write(state(value = "before"), 1_000)
        val target = root.listFiles()!!.single { it.extension == "state" }
        File(root, target.name + ".new").mkdir()
        assertThrows(Exception::class.java) { store.write(state(value = "after"), 1_001) }
        assertEquals("before", store.readAll(1_002).states["tab-a"]?.state)
    }

    @Test fun corruptedOrDifferentEngineStatesAreQuarantinedAndNeverRestored() {
        val root = temporary.newFolder()
        val store = SessionStateStore(root, "155")
        store.write(state("corrupt"), 1_000)
        store.write(state("old-engine"), 1_000)
        val file = root.listFiles()!!.first { it.extension == "state" }
        file.writeBytes(byteArrayOf(1, 2, 3))
        val result = SessionStateStore(root, "156").readAll(1_001)
        assertTrue(result.states.isEmpty())
        assertEquals(2, result.issues.size)
        assertEquals(2, root.listFiles()!!.count { it.extension == "bad" })
    }

    @Test fun stateAndTotalBudgetsCannotGrowWithoutBound() {
        val root = temporary.newFolder()
        val store = SessionStateStore(root, "155", maxStateBytes = 100, maxTotalBytes = 550)
        assertThrows(IllegalArgumentException::class.java) { store.write(state(value = "x".repeat(101)), 1_000) }
        repeat(12) { store.write(state("tab-$it", at = 1_000L + it, value = "x".repeat(70)), 1_020) }
        assertTrue(root.listFiles()!!.filter { it.extension == "state" }.sumOf { it.length() } <= 550)
        assertTrue(store.readAll(1_021).states.containsKey("tab-11"))
    }

    @Test fun reconciliationAndRetentionDeleteOnlyUnneededState() {
        val root = temporary.newFolder()
        val store = SessionStateStore(root, "155", maxAgeMillis = 1_000)
        store.write(state("a", 1_000), 1_000)
        store.write(state("b", 1_100), 1_100)
        store.reconcile(setOf("b"))
        assertEquals(setOf("b"), store.readAll(1_200).states.keys)
        assertTrue(store.readAll(2_101).states.isEmpty())
    }

    @Test fun clearRemovesRestorableQuarantinedAndPartialState() {
        val root = temporary.newFolder()
        val store = SessionStateStore(root, "155")
        store.write(state(), 1_000)
        File(root, "failed.bad").writeText("sensitive")
        File(root, "partial.new").writeText("sensitive")
        store.clear()
        assertTrue(root.listFiles()!!.isEmpty())
        assertTrue(store.readAll(1_001).states.isEmpty())
    }

    @Test fun truncatedOrTamperedStateIsRejected() {
        val root = temporary.newFolder()
        val store = SessionStateStore(root, "155")
        store.write(state(), 1_000)
        val file = root.listFiles()!!.single()
        val bytes = file.readBytes()
        bytes[bytes.lastIndex] = (bytes.last() + 1).toByte()
        Files.write(file.toPath(), bytes)
        val result = store.readAll(1_001)
        assertTrue(result.states.isEmpty())
        assertEquals(1, result.issues.size)
    }

    @Test fun clearedTabsStayPausedAcrossProcessRestartUntilExplicitlyResumed() {
        val file = File(temporary.newFolder(), "paused.json")
        PausedSessionStore(file).write(setOf("a", "b"))
        assertEquals(setOf("a", "b"), PausedSessionStore(file).read())
        PausedSessionStore(file).write(setOf("b"))
        assertEquals(setOf("b"), PausedSessionStore(file).read())
        PausedSessionStore(file).write(emptySet())
        assertTrue(PausedSessionStore(file).read().isEmpty())
    }

    @Test fun malformedPauseLedgerNeverSilentlyAllowsPreviouslyClearedPagesToLoad() {
        val file = File(temporary.newFolder(), "paused.json")
        file.writeText("{broken")
        assertThrows(Exception::class.java) { PausedSessionStore(file).read() }
        assertEquals("{broken", file.readText())
    }
}
