package dev.browser

sealed class KeyAction {
    data object Pass : KeyAction()
    data object Consume : KeyAction()
    data class Command(val command: String) : KeyAction()
    data class InputKey(val key: String) : KeyAction()
}
data class KeyBinding(val key: String, val meta: Boolean = false, val ctrl: Boolean = false,
    val alt: Boolean = false, val shift: Boolean = false, val command: String)

/** Pure synchronous state machine. Retains key-down decisions until the matching key-up. */
class RemapEngine {
    var bindings: List<KeyBinding> = emptyList()
    var addressInputActive = false
    var chromeModalActive = false
    private val held = mutableMapOf<String, KeyAction>()
    fun route(key: String, down: Boolean, meta: Boolean = false, ctrl: Boolean = false,
        alt: Boolean = false, shift: Boolean = false): KeyAction {
        val previous = held[key]
        if (!down) { held.remove(key); return previous ?: KeyAction.Pass }
        if (previous != null) return previous
        if (addressInputActive && !meta && !ctrl && !alt && !shift) {
            val inputKey = when (key) {
                "DPAD_UP" -> "ArrowUp"
                "DPAD_DOWN" -> "ArrowDown"
                "ENTER", "NUMPAD_ENTER" -> "Enter"
                "ESCAPE" -> "Escape"
                else -> null
            }
            if (inputKey != null) {
                held[key] = KeyAction.Consume
                return KeyAction.InputKey(inputKey)
            }
        }
        if (chromeModalActive && key == "ESCAPE" && !meta && !ctrl && !alt && !shift) {
            held[key] = KeyAction.Consume
            return KeyAction.Command("chrome.dismiss")
        }
        val binding = bindings.firstOrNull { it.key.equals(key, true) && it.meta == meta &&
            it.ctrl == ctrl && it.alt == alt && it.shift == shift }
        if (binding != null) { held[key] = KeyAction.Consume; return KeyAction.Command(binding.command) }
        held[key] = KeyAction.Pass
        return KeyAction.Pass
    }
    fun reset() { held.clear(); addressInputActive = false; chromeModalActive = false }
}
