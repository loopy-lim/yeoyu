import { parseKeymap } from "./keyboardEditor";
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
  return withCtrlAlternatives(parseKeymap(draft));
}
