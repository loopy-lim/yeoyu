package dev.browser
import org.junit.Assert.*
import org.junit.Test
class RemapEngineTest {
 @Test fun capsAndLettersPassThroughWithoutBrowserRemapping() {
  for (capsKey in listOf("CAPS", "CAPS_LOCK")) {
   val e = RemapEngine()
   assertEquals(KeyAction.Pass, e.route(capsKey, true))
   assertEquals(KeyAction.Pass, e.route("H", true))
   assertEquals(KeyAction.Pass, e.route("H", false))
   assertEquals(KeyAction.Pass, e.route(capsKey, false))
  }
 }
 @Test fun modifierPressedDuringHeldOrdinaryKeyPreservesItsPair() {
  val e = RemapEngine()
  e.bindings = listOf(KeyBinding("H", ctrl=true, command="tab.new"))
  assertEquals(KeyAction.Pass, e.route("H", true))
  assertEquals(KeyAction.Pass, e.route("H", true, ctrl=true))
  assertEquals(KeyAction.Pass, e.route("H", false, ctrl=true))
 }
 @Test fun commandRepeatsAndReleaseStayConsumedAfterModifiersChange() {
  val e = RemapEngine()
  e.bindings = listOf(KeyBinding("T", meta=true, command="tab.new"))
  assertEquals(KeyAction.Command("tab.new"), e.route("T", true, meta=true))
  assertEquals(KeyAction.Consume, e.route("T", true))
  assertEquals(KeyAction.Consume, e.route("T", false))
  assertEquals(KeyAction.Pass, e.route("T", true))
 }
 @Test fun ctrlBindingMatchesCaseInsensitivelyWithoutConsumingPlainText() {
  val e = RemapEngine()
  e.bindings = listOf(KeyBinding("w", ctrl=true, command="tab.close"))
  assertEquals(KeyAction.Command("tab.close"), e.route("W", true, ctrl=true))
  assertEquals(KeyAction.Consume, e.route("W", false))
  assertEquals(KeyAction.Pass, e.route("W", true))
  assertEquals(KeyAction.Pass, e.route("W", false))
 }
 @Test fun focusResetClearsHeldCommandsButPreservesBindings() {
  val e = RemapEngine()
  e.bindings = listOf(KeyBinding("K", ctrl=true, command="commandPalette.open"))
  assertEquals(KeyAction.Command("commandPalette.open"), e.route("K", true, ctrl=true))
  e.reset()
  assertEquals(KeyAction.Pass, e.route("K", false))
  assertEquals(KeyAction.Command("commandPalette.open"), e.route("K", true, ctrl=true))
 }
 @Test fun focusedAddressCapturesArrowsEnterEscapeOnceAndConsumesTheirPairs() {
  val e = RemapEngine()
  e.addressInputActive = true
  for ((key, expected) in mapOf("DPAD_UP" to "ArrowUp", "DPAD_DOWN" to "ArrowDown", "ENTER" to "Enter", "ESCAPE" to "Escape")) {
   assertEquals(KeyAction.InputKey(expected), e.route(key, true))
   assertEquals(KeyAction.Consume, e.route(key, true))
   e.addressInputActive = false
   assertEquals(KeyAction.Consume, e.route(key, false))
   assertEquals(KeyAction.Pass, e.route(key, true))
   assertEquals(KeyAction.Pass, e.route(key, false))
   e.addressInputActive = true
  }
 }
 @Test fun addressCapturePreservesModifiedShortcutsAndOrdinaryTyping() {
  val e = RemapEngine()
  e.addressInputActive = true
  e.bindings = listOf(KeyBinding("DPAD_UP", ctrl=true, command="tab.previous"))
  assertEquals(KeyAction.Command("tab.previous"), e.route("DPAD_UP", true, ctrl=true))
  assertEquals(KeyAction.Consume, e.route("DPAD_UP", false))
  assertEquals(KeyAction.Pass, e.route("DPAD_DOWN", true, shift=true))
  assertEquals(KeyAction.Pass, e.route("DPAD_DOWN", false))
  assertEquals(KeyAction.Pass, e.route("A", true))
  assertEquals(KeyAction.Pass, e.route("A", false))
 }
 @Test fun aKeyPressedBeforeAddressFocusDoesNotBecomeCapturedMidPress() {
  val e = RemapEngine()
  assertEquals(KeyAction.Pass, e.route("ENTER", true))
  e.addressInputActive = true
  assertEquals(KeyAction.Pass, e.route("ENTER", true))
  assertEquals(KeyAction.Pass, e.route("ENTER", false))
  assertEquals(KeyAction.InputKey("Enter"), e.route("ENTER", true))
 }
 @Test fun losingWindowFocusDisablesAddressCapture() {
  val e = RemapEngine()
  e.addressInputActive = true
  assertEquals(KeyAction.InputKey("Escape"), e.route("ESCAPE", true))
  e.reset()
  assertFalse(e.addressInputActive)
  assertEquals(KeyAction.Pass, e.route("ESCAPE", true))
 }
 @Test fun modalEscapeDismissesOnceAndConsumesReleaseEvenAfterModalCloses() {
  val e = RemapEngine()
  e.chromeModalActive = true
  assertEquals(KeyAction.Command("chrome.dismiss"), e.route("ESCAPE", true))
  e.chromeModalActive = false
  assertEquals(KeyAction.Consume, e.route("ESCAPE", true))
  assertEquals(KeyAction.Consume, e.route("ESCAPE", false))
  assertEquals(KeyAction.Pass, e.route("ESCAPE", true))
 }
 @Test fun addressCaptureTakesPriorityOverModalEscape() {
  val e = RemapEngine()
  e.chromeModalActive = true
  e.addressInputActive = true
  assertEquals(KeyAction.InputKey("Escape"), e.route("ESCAPE", true))
  assertEquals(KeyAction.Consume, e.route("ESCAPE", false))
  e.addressInputActive = false
  assertEquals(KeyAction.Command("chrome.dismiss"), e.route("ESCAPE", true))
 }
 @Test fun modalEscapePreservesModifiedBindingsAndKeysPressedBeforeTheModal() {
  val e = RemapEngine()
  assertEquals(KeyAction.Pass, e.route("ESCAPE", true))
  e.chromeModalActive = true
  assertEquals(KeyAction.Pass, e.route("ESCAPE", true))
  assertEquals(KeyAction.Pass, e.route("ESCAPE", false))
  e.bindings = listOf(KeyBinding("ESCAPE", ctrl=true, command="custom.escape"))
  assertEquals(KeyAction.Command("custom.escape"), e.route("ESCAPE", true, ctrl=true))
  assertEquals(KeyAction.Consume, e.route("ESCAPE", false))
  assertEquals(KeyAction.Pass, e.route("ESCAPE", true, shift=true))
  assertEquals(KeyAction.Pass, e.route("ESCAPE", false))
  assertEquals(KeyAction.Pass, e.route("DPAD_DOWN", true))
 }
 @Test fun windowFocusResetClearsBothCaptureFlags() {
  val e = RemapEngine()
  e.chromeModalActive = true
  e.addressInputActive = true
  e.reset()
  assertFalse(e.chromeModalActive)
  assertFalse(e.addressInputActive)
  assertEquals(KeyAction.Pass, e.route("ESCAPE", true))
 }
}
