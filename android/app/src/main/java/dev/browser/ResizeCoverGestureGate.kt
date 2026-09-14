package dev.browser

internal class ResizeCoverGestureGate {
    private var blocked = false
    private var tracking = false
    private var gestureTarget: Any? = null

    fun consume(startsGesture: Boolean, endsGesture: Boolean, covered: Boolean, target: Any?): Boolean {
        if (startsGesture) {
            // A cover appearing mid-scroll must not steal an existing gesture.
            blocked = covered
            tracking = true
            gestureTarget = target
        } else if (tracking && gestureTarget !== target) {
            invalidate()
        }
        val consume = blocked
        if (endsGesture) {
            blocked = false
            tracking = false
            gestureTarget = null
        }
        return consume
    }

    fun invalidate() {
        // Do not send a detached/replaced page's MOVE or UP to its successor.
        // A fresh DOWN starts normally even if Android never sent the old end.
        blocked = true
        tracking = false
        gestureTarget = null
    }
}
