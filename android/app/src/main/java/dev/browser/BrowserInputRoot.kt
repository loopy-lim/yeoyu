package dev.browser

import android.content.Context
import android.view.KeyEvent
import android.view.WindowInsets
import android.widget.FrameLayout

/** Configured command shortcuts run before the IME; ordinary input is unchanged. */
class BrowserInputRoot(context: Context, private val routePreIme: Boolean = true) : FrameLayout(context) {
  internal var viewportObserver: ((WindowInsets) -> Unit)? = null

  override fun onApplyWindowInsets(insets: WindowInsets): WindowInsets {
    viewportObserver?.invoke(insets)
    return super.onApplyWindowInsets(insets)
  }

  override fun dispatchKeyEventPreIme(event: KeyEvent): Boolean =
    if (!routePreIme) super.dispatchKeyEventPreIme(event) else InputRouter.dispatch(event) { original -> super.dispatchKeyEventPreIme(original) }
}
