import type { KeyBinding } from "../generated/types";

export function parseKeymap(draft: string): KeyBinding[] {
  const value: unknown = JSON.parse(draft);
  if (!Array.isArray(value)) throw new Error("Shortcuts must be a JSON array");
  const chords = new Set<string>();
  return value.map((row: unknown, index): KeyBinding => {
    if (!row || typeof row !== "object")
      throw new Error(`Shortcut ${index + 1} is invalid`);
    const r = row as Record<string, unknown>;
    if (
      typeof r.key !== "string" ||
      !r.key.trim() ||
      typeof r.command !== "string" ||
      !r.command.trim() ||
      [r.meta, r.ctrl, r.alt, r.shift].some((v) => typeof v !== "boolean")
    )
      throw new Error(
        `Shortcut ${index + 1} needs a key, action, and valid modifiers`
      );
    const binding: KeyBinding = {
      key: r.key.trim(),
      command: r.command.trim(),
      meta: r.meta as boolean,
      ctrl: r.ctrl as boolean,
      alt: r.alt as boolean,
      shift: r.shift as boolean,
    };
    const chord = JSON.stringify([
      binding.key.toLowerCase(),
      binding.meta,
      binding.ctrl,
      binding.alt,
      binding.shift,
    ]);
    if (chords.has(chord))
      throw new Error(
        `Shortcut ${index + 1} duplicates ${shortcutLabel(binding)}`
      );
    chords.add(chord);
    return binding;
  });
}

export function shortcutLabel(binding: KeyBinding): string {
  return [
    binding.ctrl && "Ctrl",
    binding.meta && "⌘",
    binding.alt && "Alt",
    binding.shift && "Shift",
    binding.key.toUpperCase(),
  ]
    .filter(Boolean)
    .join(" + ");
}
