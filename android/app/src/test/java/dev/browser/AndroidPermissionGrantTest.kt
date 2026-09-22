package dev.browser

import android.Manifest
import org.junit.Assert.*
import org.junit.Test

class AndroidPermissionGrantTest {
    private val fine = Manifest.permission.ACCESS_FINE_LOCATION
    private val coarse = Manifest.permission.ACCESS_COARSE_LOCATION
    private val camera = Manifest.permission.CAMERA
    private val microphone = Manifest.permission.RECORD_AUDIO

    @Test fun acceptsApproximateLocationWhenBothAccuracyLevelsWereRequested() {
        assertTrue(requestedAndroidPermissionsHeld(arrayOf(fine, coarse)) { it == coarse })
        assertTrue(requestedAndroidPermissionsHeld(arrayOf(fine, coarse)) { it == fine })
        assertFalse(requestedAndroidPermissionsHeld(arrayOf(fine, coarse)) { false })
    }

    @Test fun approximateLocationDoesNotGrantAnotherRequestedCapability() {
        assertFalse(requestedAndroidPermissionsHeld(arrayOf(fine, coarse, camera)) { it == coarse })
        assertFalse(requestedAndroidPermissionsHeld(arrayOf(camera, microphone)) { it == camera })
        assertTrue(requestedAndroidPermissionsHeld(arrayOf(camera, microphone)) { true })
    }

    @Test fun doesNotInventAnUnrequestedCoarseAlternative() {
        assertFalse(requestedAndroidPermissionsHeld(arrayOf(fine)) { it == coarse })
    }
}
