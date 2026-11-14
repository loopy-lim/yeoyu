import { cva } from "class-variance-authority";
import { cn } from "@/ui/cn";
import React, { useLayoutEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { KeyBinding } from "@generated/types";
import type { ProductCommand } from "@/commandRegistry";
import { parseKeymap, shortcutLabel } from "@/keyboardEditor";
import { withCtrlAlternatives } from "@/keyboardProfiles";
import { useTheme } from "@/themeContext";
import { DialogCard } from "@/components/DialogCard";
import { useI18n } from "@/i18nContext";

const c = {
  title: "text-title font-bold text-ink",
  text: "text-input-plus font-medium text-ink leading-[21px]",
  muted: "text-body text-ink-muted leading-[19px]",
  sectionLabel:
    "text-small font-bold text-ink-faint tracking-[0.6px] uppercase mt-md",
  actions: "flex-row flex-wrap gap-sm",
  footer:
    "flex-row flex-wrap gap-sm pt-lg border-t-hairline-width border-t-hairline",
  button:
    "min-h-[40px] px-xl py-sm rounded-control bg-surface-elevated border border-hairline justify-center active:opacity-pressed",
  saveButton:
    "min-h-[40px] px-xl py-sm rounded-control bg-ink border border-ink justify-center active:opacity-pressed",
  saveText: "text-input-plus font-semibold text-surface-elevated",
  input:
    "min-h-[42px] text-ink text-input-plus bg-surface-elevated border border-hairline rounded-control px-xxl",
  row: "gap-md p-lg rounded-tile bg-sunken border border-hairline",
  rowHeader: "flex-row items-center justify-between gap-md",
  shortcutBadge:
    "px-sm py-[2px] rounded-chip bg-surface-elevated border border-hairline text-small font-semibold text-ink-muted",
} as const;
const actionClasses = cva(c.button, {
  variants: {
    disabled: { true: "opacity-50", false: "" },
    selected: { true: "bg-sunken-strong border-accent-strong", false: "" },
  },
});

export function KeyboardSettings({
  bindings,
  commands,
  onDefaults,
  onSave,
  onClose,
}: {
  bindings: KeyBinding[];
  commands: ProductCommand[];
  onDefaults(): Promise<KeyBinding[]>;
  onSave(bindings: KeyBinding[]): Promise<unknown>;
  onClose(): void;
}) {
  const t = useTheme();
  const { tr } = useI18n();
  const [rows, setRows] = useState(() =>
    bindings.map((b, id) => ({ id, ...b }))
  );
  const nextId = useRef(bindings.length);
  const operationPending = useRef(false);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [query, setQuery] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [json, setJson] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const values = () => rows.map(({ id: _id, ...binding }) => binding);
  const replace = (bindings: KeyBinding[]) => {
    setRows(bindings.map((binding, id) => ({ id, ...binding })));
    nextId.current = bindings.length;
  };
  const runAction = async (
    operation: "toggleEditor" | "defaults" | "alternatives" | "save"
  ) => {
    // State disables visible controls; the ref also rejects a second press
    // received before React commits that disabled state.
    if (operationPending.current) return;
    operationPending.current = true;
    setBusy(true);
    setError("");
    try {
      switch (operation) {
        case "toggleEditor":
          if (advanced) replace(parseKeymap(json));
          else setJson(JSON.stringify(values(), null, 2));
          setAdvanced(!advanced);
          break;
        case "defaults":
          replace(await onDefaults());
          setAdvanced(false);
          setQuery("");
          break;
        case "alternatives":
          replace(
            withCtrlAlternatives(
              parseKeymap(advanced ? json : JSON.stringify(values()))
            )
          );
          setAdvanced(false);
          break;
        case "save":
          await onSave(parseKeymap(advanced ? json : JSON.stringify(values())));
          // Back can close this instance while its accepted save continues.
          // Its completion must not dismiss an editor opened in the meantime.
          if (mounted.current) onClose();
          break;
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      operationPending.current = false;
      setBusy(false);
    }
  };
  const addShortcut = (command: string) => {
    if (operationPending.current) return;
    // Allocate outside the state updater; React may replay the pure updater.
    const row = {
      id: nextId.current++,
      key: "",
      command,
      ctrl: true,
      meta: false,
      alt: false,
      shift: false,
    };
    setRows((old) => [...old, row]);
  };
  const button = (label: string, onPress: () => void, selected?: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{
        disabled: busy,
        ...(selected === undefined ? {} : { selected }),
      }}
      disabled={busy}
      className={cn(actionClasses({ selected, disabled: busy }))}
      onPress={onPress}
    >
      <Text className={c.text}>{label}</Text>
    </Pressable>
  );
  const titleFor = (id: string) =>
    commands.find((c) => c.id === id)?.title ?? id;
  return (
    <DialogCard variant="editor">
      <Text className={c.title}>{tr("keyboard.title")}</Text>
      <Text className={c.muted}>{tr("keyboard.help")}</Text>
      {error ? (
        <Text
          accessibilityRole="alert"
          className="text-body text-error-ink bg-error-bg px-lg py-md rounded-control"
        >
          {error}
        </Text>
      ) : null}
      {!advanced && (
        <TextInput
          accessibilityLabel={tr("keyboard.search")}
          className={c.input}
          value={query}
          onChangeText={setQuery}
          placeholder={tr("keyboard.searchHint")}
          placeholderTextColor={t.inkMuted}
        />
      )}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="gap-md pb-lg"
      >
        {advanced ? (
          <TextInput
            accessibilityLabel={tr("keyboard.json")}
            editable={!busy}
            multiline
            value={json}
            onChangeText={setJson}
            autoCorrect={false}
            autoCapitalize="none"
            disableFullscreenUI
            className={cn(c.input, "min-h-[250px] py-lg align-top")}
          />
        ) : (
          rows
            .filter((row) =>
              `${titleFor(row.command)} ${row.command} ${shortcutLabel(row)}`
                .toLowerCase()
                .includes(query.toLowerCase())
            )
            .map((row) => (
              <View key={row.id} className={c.row}>
                <View className={c.rowHeader}>
                  <Text className={c.text}>{titleFor(row.command)}</Text>
                  <Text className={c.shortcutBadge}>
                    {shortcutLabel(row)}
                  </Text>
                </View>
                <TextInput
                  editable={!busy}
                  accessibilityLabel={tr("keyboard.keyFor", {
                    action: titleFor(row.command),
                  })}
                  value={row.key}
                  className={c.input}
                  onChangeText={(key) =>
                    setRows((old) =>
                      old.map((r) => (r.id === row.id ? { ...r, key } : r))
                    )
                  }
                  autoCapitalize="none"
                  autoCorrect={false}
                  disableFullscreenUI
                />
                <View className={c.actions}>
                  {(["ctrl", "meta", "alt", "shift"] as const).map(
                    (modifier) => (
                      <React.Fragment key={modifier}>
                        {button(
                          `${
                            modifier === "meta"
                              ? "⌘"
                              : modifier[0].toUpperCase() + modifier.slice(1)
                          } · ${titleFor(row.command)}`,
                          () =>
                            setRows((old) =>
                              old.map((r) =>
                                r.id === row.id
                                  ? { ...r, [modifier]: !r[modifier] }
                                  : r
                              )
                            ),
                          row[modifier]
                        )}
                      </React.Fragment>
                    )
                  )}
                </View>
                {button(
                  tr("keyboard.remove", { shortcut: shortcutLabel(row) }),
                  () => setRows((old) => old.filter((r) => r.id !== row.id))
                )}
              </View>
            ))
        )}
        {!advanced && (
          <>
            <Text className={c.sectionLabel}>{tr("keyboard.add")}</Text>
            <View className={c.actions}>
              {commands
                .filter((c) =>
                  `${c.title} ${c.id}`
                    .toLowerCase()
                    .includes(query.toLowerCase())
                )
                .map((command) => (
                  <React.Fragment key={command.id}>
                    {button(command.title, () => addShortcut(command.id))}
                  </React.Fragment>
                ))}
            </View>
          </>
        )}
      </ScrollView>
      <View className={c.footer}>
        {button(
          tr(advanced ? "keyboard.visual" : "keyboard.advanced"),
          () => void runAction("toggleEditor")
        )}
        {button(tr("keyboard.defaults"), () => void runAction("defaults"))}
        {button(
          tr("keyboard.alternatives"),
          () => void runAction("alternatives")
        )}
        <View className="flex-1" />
        {button(tr("keyboard.cancel"), onClose)}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr("keyboard.save")}
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          className={cn(c.saveButton, busy && "opacity-50")}
          onPress={() => void runAction("save")}
        >
          <Text className={c.saveText}>{tr("keyboard.save")}</Text>
        </Pressable>
      </View>
    </DialogCard>
  );
}
