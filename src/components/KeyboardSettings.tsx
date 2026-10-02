import { cva } from "class-variance-authority";
import { cn } from "@/ui/cn";
import React, { useLayoutEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { KeyBinding } from "@generated/types";
import type { ProductCommand } from "@/commandRegistry";
import { parseKeymap, shortcutLabel } from "@/keyboardEditor";
import { withCtrlAlternatives } from "@/keyboardProfiles";
import { useTheme } from "@/themeContext";
import { useI18n } from "@/i18nContext";

const c = {
  root: "w-[92%] max-w-[760px] max-h-[88%] bg-surface-elevated rounded-card p-[20px] gap-xxl",
  title: "text-[20px] font-semibold text-ink",
  text: "text-input-plus text-ink leading-[21px]",
  muted: "text-input text-ink-muted leading-[20px]",
  actions: "flex-row flex-wrap gap-lg",
  button:
    "min-h-action-row px-xxl py-xxl rounded-[8px] border border-ink-muted justify-center active:opacity-pressed",
  input:
    "min-h-action-row text-ink text-icon-size border border-ink-muted rounded-[8px] p-xxl",
  row: "gap-lg py-[14px] border-b border-hairline",
} as const;
const actionClasses = cva(c.button, {
  variants: {
    disabled: { true: "opacity-50", false: "" },
    selected: { true: "bg-sunken-strong border-ink", false: "" },
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
    <View className={c.root}>
      <Text className={c.title}>{tr("keyboard.title")}</Text>
      <Text className={c.muted}>{tr("keyboard.help")}</Text>
      {error ? (
        <Text accessibilityRole="alert" className={c.text}>
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
        contentContainerClassName="gap-lg"
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
            className={cn(c.input, "min-h-[250px] align-top")}
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
                <Text className={c.text}>{titleFor(row.command)}</Text>
                <Text className={c.muted}>{shortcutLabel(row)}</Text>
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
            <Text className={c.text}>{tr("keyboard.add")}</Text>
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
      <View className={c.actions}>
        {button(
          tr(advanced ? "keyboard.visual" : "keyboard.advanced"),
          () => void runAction("toggleEditor")
        )}
        {button(tr("keyboard.defaults"), () => void runAction("defaults"))}
        {button(
          tr("keyboard.alternatives"),
          () => void runAction("alternatives")
        )}
        {button(tr("keyboard.save"), () => void runAction("save"))}
        {button(tr("keyboard.cancel"), onClose)}
      </View>
    </View>
  );
}
