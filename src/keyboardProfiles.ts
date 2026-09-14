import type { KeyBinding } from "../generated/types";
/** Optional user preset for devices whose OS reserves Meta chords. Rust validates/saves it. */
export function withCtrlAlternatives(bindings: KeyBinding[]): KeyBinding[] {
  const result = [...bindings];
  for (const binding of bindings) {
    if (!binding.meta || binding.ctrl) continue;
    const alias = { ...binding, meta: false, ctrl: true };
    if (
      !result.some(
        (b) =>
          b.key.toLowerCase() === alias.key.toLowerCase() &&
          b.meta === alias.meta &&
          b.ctrl === alias.ctrl &&
          b.alt === alias.alt &&
          b.shift === alias.shift
      )
    )
      result.push(alias);
  }
  return result;
}

export function withCtrlAlternativesFromDraft(draft: string): KeyBinding[] {
  const parsed: unknown = JSON.parse(draft);
  if (!Array.isArray(parsed)) throw new Error("Keymap JSON must be an array");
  return withCtrlAlternatives(parsed as KeyBinding[]);
}
