package dev.browser

import android.content.Context
import android.view.KeyEvent
import android.widget.FrameLayout

/** Configured command shortcuts run before the IME; ordinary input is unchanged. */
class BrowserInputRoot(context: Context) : FrameLayout(context) {
  override fun dispatchKeyEventPreIme(event: KeyEvent): Boolean =
    InputRouter.dispatch(event) { original -> super.dispatchKeyEventPreIme(original) }
}
