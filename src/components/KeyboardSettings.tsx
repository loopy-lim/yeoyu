import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { KeyBinding } from "../../generated/types";
import type { ProductCommand } from "../commandRegistry";
import { parseKeymap, shortcutLabel } from "../keyboardEditor";
import { withCtrlAlternatives } from "../keyboardProfiles";
import { useTheme } from "../themeContext";
import { useI18n } from "../i18nContext";

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
    return () => { mounted.current = false; };
  }, []);
  const [query, setQuery] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [json, setJson] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const s = useMemo(
    () =>
      StyleSheet.create({
        root: {
          width: "92%",
          maxWidth: 760,
          maxHeight: "88%",
          backgroundColor: t.surfaceElevated,
          borderRadius: 16,
          padding: 20,
          gap: 12,
        },
        title: { fontSize: 20, fontWeight: "600", color: t.ink },
        text: { fontSize: 14, color: t.ink, lineHeight: 21 },
        muted: { fontSize: 13, color: t.inkMuted, lineHeight: 20 },
        actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
        button: {
          minHeight: 48,
          paddingHorizontal: 12,
          paddingVertical: 12,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: t.inkMuted,
          justifyContent: "center",
        },
        input: {
          minHeight: 48,
          color: t.ink,
          fontSize: 16,
          borderWidth: 1,
          borderColor: t.inkMuted,
          borderRadius: 8,
          padding: 12,
        },
        row: {
          gap: 8,
          paddingVertical: 14,
          borderBottomWidth: 1,
          borderBottomColor: t.hairline,
        },
        selected: { backgroundColor: t.sunkenStrong, borderColor: t.ink },
      }),
    [t]
  );
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
      style={[s.button, selected && s.selected, busy && { opacity: 0.5 }]}
      onPress={onPress}
    >
      <Text style={s.text}>{label}</Text>
    </Pressable>
  );
  const titleFor = (id: string) =>
    commands.find((c) => c.id === id)?.title ?? id;
  return (
    <View style={s.root}>
      <Text style={s.title}>{tr("keyboard.title")}</Text>
      <Text style={s.muted}>
        {tr("keyboard.help")}
      </Text>
      {error ? (
        <Text accessibilityRole="alert" style={s.text}>
          {error}
        </Text>
      ) : null}
      {!advanced && (
        <TextInput
          accessibilityLabel={tr("keyboard.search")}
          style={s.input}
          value={query}
          onChangeText={setQuery}
          placeholder={tr("keyboard.searchHint")}
          placeholderTextColor={t.inkMuted}
        />
      )}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: 8 }}
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
            style={[s.input, { minHeight: 250, textAlignVertical: "top" }]}
          />
        ) : (
          rows
            .filter((row) =>
              `${titleFor(row.command)} ${row.command} ${shortcutLabel(row)}`
                .toLowerCase()
                .includes(query.toLowerCase())
            )
            .map((row) => (
              <View key={row.id} style={s.row}>
                <Text style={s.text}>{titleFor(row.command)}</Text>
                <Text style={s.muted}>{shortcutLabel(row)}</Text>
                <TextInput
                  editable={!busy}
                  accessibilityLabel={tr("keyboard.keyFor", { action: titleFor(row.command) })}
                  value={row.key}
                  style={s.input}
                  onChangeText={(key) =>
                    setRows((old) =>
                      old.map((r) => (r.id === row.id ? { ...r, key } : r))
                    )
                  }
                  autoCapitalize="none"
                  autoCorrect={false}
                  disableFullscreenUI
                />
                <View style={s.actions}>
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
                {button(tr("keyboard.remove", { shortcut: shortcutLabel(row) }), () =>
                  setRows((old) => old.filter((r) => r.id !== row.id))
                )}
              </View>
            ))
        )}
        {!advanced && (
          <>
            <Text style={s.text}>{tr("keyboard.add")}</Text>
            <View style={s.actions}>
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
      <View style={s.actions}>
        {button(
          tr(advanced ? "keyboard.visual" : "keyboard.advanced"),
          () => void runAction("toggleEditor")
        )}
        {button(tr("keyboard.defaults"), () => void runAction("defaults"))}
        {button(tr("keyboard.alternatives"), () => void runAction("alternatives"))}
        {button(tr("keyboard.save"), () => void runAction("save"))}
        {button(tr("keyboard.cancel"), onClose)}
      </View>
    </View>
  );
}
