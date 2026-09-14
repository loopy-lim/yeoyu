package dev.browser

import java.io.IOException
import org.junit.Assert.*
import org.junit.Test

class SnapshotPersistenceTest {
    @Test fun failedCommitRestoresTheSharedPreferencesMemoryViewAndFallback() {
        val values = mutableMapOf<String, String?>("snapshot" to "before", "snapshot.lastGood" to "older")
        var writes = 0
        val store = SnapshotPersistence({ values[it] }) { changes ->
            // SharedPreferences applies edits in memory even when disk commit returns false.
            values.putAll(changes); writes++; false
        }
        assertThrows(IOException::class.java) { store.save("candidate") }
        assertEquals("before", values["snapshot"])
        assertEquals("older", values["snapshot.lastGood"])
        assertEquals(2, writes)
    }
    @Test fun successfulWriteRotatesOnlyThePreviousPrimary() {
        val values = mutableMapOf<String, String?>("snapshot" to "before", "snapshot.lastGood" to "older")
        SnapshotPersistence({ values[it] }) { changes -> values.putAll(changes); true }.save("candidate")
        assertEquals("candidate", values["snapshot"])
        assertEquals("before", values["snapshot.lastGood"])
    }
}
