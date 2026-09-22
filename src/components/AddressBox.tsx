import React, {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AppState,
  DeviceEventEmitter,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Favicon } from "./Favicon";
import { ChromeIcon } from "../chrome/ChromeIcon";
import { josaRo } from "../i18n";
import {
  normalizeInput,
  suggest,
  type SearchEngineId,
  type Suggestion,
} from "../suggestions";
import { matchingCommands, type ProductCommand } from "../commandRegistry";
import type { HistoryEntry } from "../history";
import { platform } from "../platform";
import { font, radius, space } from "../theme";
import { useTheme } from "../themeContext";
import { useI18n } from "../i18nContext";

interface Props {
  engine: SearchEngineId;
  value?: string;
  autoFocus?: boolean;
  placeholder?: string;
  reducedMotion?: boolean;
  softInput?: boolean;
  suggestions: {
    favorites: { id?: string; url: string; title: string }[];
    bookmarks: { url: string; title: string }[];
    tabs: { id?: string; url: string; title: string }[];
    history: HistoryEntry[];
  };
  commands?: ProductCommand[];
  onCommand?: (id: string) => void;
  onOpenTab?: (id: string) => void;
  onDismiss?: () => void;
  onSubmit: (url: string) => void;
}

type Result =
  | { kind: "command"; command: ProductCommand }
  | { kind: "page"; page: Suggestion };

/** URL/search, existing tabs and product commands share one keyboard selection model. */
export const AddressBox = forwardRef<
  React.ComponentRef<typeof TextInput>,
  Props
>((props, ref) => {
  const t = useTheme();
  const { tr } = useI18n();
  const [query, setQuery] = useState(props.value ?? "");
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const inputRef = useRef<React.ComponentRef<typeof TextInput> | null>(null);
  const setRefs = (instance: React.ComponentRef<typeof TextInput> | null) => {
    inputRef.current = instance;
    if (typeof ref === "function") ref(instance);
    else if (ref) ref.current = instance;
  };
  useEffect(() => {
    if (props.autoFocus) inputRef.current?.focus();
  }, [props.autoFocus]);
  useEffect(() => {
    if (props.value !== undefined) setQuery(props.value);
  }, [props.value]);
  const results = useMemo<Result[]>(
    () =>
      [
        ...(props.onCommand
          ? matchingCommands(query, props.commands ?? []).map((command) => ({
              kind: "command" as const,
              command,
            }))
          : []),
        ...suggest(query, props.suggestions).map((page) => ({
          kind: "page" as const,
          page,
        })),
      ].slice(0, 8),
    [query, props.suggestions, props.commands, props.onCommand]
  );
  const visible = focused && results.length > 0;
  const select = (result?: Result) => {
    if (result?.kind === "command") {
      props.onCommand?.(result.command.id);
      return;
    }
    if (result?.kind === "page" && result.page.tabId && props.onOpenTab) {
      props.onOpenTab(result.page.tabId);
      return;
    }
    const url = normalizeInput(
      result?.kind === "page" ? result.page.url : query,
      props.engine
    );
    if (url) props.onSubmit(url);
  };
  const onKey = (key: string) => {
    if (key === "ArrowDown")
      setHighlight((value) => Math.min(value + 1, results.length - 1));
    else if (key === "ArrowUp")
      setHighlight((value) => Math.max(value - 1, -1));
    else if (key === "Enter")
      select(highlight >= 0 ? results[highlight] : undefined);
    else if (key === "Escape") props.onDismiss?.();
  };
  const keyHandler = useRef(onKey);
  useLayoutEffect(() => {
    keyHandler.current = onKey;
  });
  useEffect(() => {
    if (!focused) return;
    const subscription = DeviceEventEmitter.addListener(
      "BrowserInputKey",
      (event: { key: string }) => keyHandler.current(event.key)
    );
    return () => subscription.remove();
  }, [focused]);
  useEffect(() => {
    const enable = () => platform?.setAddressInputActive?.(focused);
    enable();
    const focusSubscription = DeviceEventEmitter.addListener(
      "BrowserWindowFocus",
      (event: { focused: boolean }) => {
        if (event.focused) enable();
      }
    );
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") enable();
      else platform?.setAddressInputActive?.(false);
    });
    return () => {
      focusSubscription.remove();
      subscription.remove();
      platform?.setAddressInputActive?.(false);
    };
  }, [focused]);
  return (
    <View style={{ alignSelf: "stretch" }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingHorizontal: space.xxl,
          minHeight: 48,
          borderRadius: radius.tile,
          backgroundColor: t.sunken,
        }}
      >
        <ChromeIcon name="search" size={18} color={t.inkMuted} />
        <TextInput
          ref={setRefs}
          accessibilityLabel={tr("address.label")}
          maxFontSizeMultiplier={1.35}
          style={{
            height: 48,
            flex: 1,
            padding: 0,
            fontSize: 15,
            color: t.ink,
          }}
          value={query}
          onChangeText={(value) => {
            setQuery(value);
            setHighlight(-1);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoCapitalize="none"
          autoCorrect={false}
          disableFullscreenUI
          keyboardType="url"
          returnKeyType="go"
          showSoftInputOnFocus={props.softInput !== false}
          selectTextOnFocus
          placeholder={props.placeholder ?? tr("address.placeholder")}
          placeholderTextColor={t.inkMuted}
          onSubmitEditing={() =>
            select(highlight >= 0 ? results[highlight] : undefined)
          }
          onKeyPress={({ nativeEvent }) => {
            if (nativeEvent.key !== "Enter") onKey(nativeEvent.key);
          }}
        />
      </View>
      {visible && (
        <ScrollView
          keyboardShouldPersistTaps="always"
          style={{ maxHeight: 340, marginTop: 6 }}
        >
          {results.map((result, index) => {
            const command = result.kind === "command" ? result.command : null;
            const page = result.kind === "page" ? result.page : null;
            const title = command?.title ?? page!.title;
            return (
              <Pressable
                key={command ? command.id : `${page!.source}:${page!.url}`}
                accessibilityRole="button"
                accessibilityLabel={command ? title : tr("address.go", { title, ro: josaRo(title) })}
                accessibilityState={{ selected: highlight === index }}
                onPress={() => select(result)}
                style={({ pressed }) => ({
                  minHeight: 44,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 8,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  backgroundColor:
                    highlight === index || pressed ? t.sunken : "transparent",
                })}
              >
                {command ? (
                  <ChromeIcon name="chevronRight" size={16} />
                ) : (
                  <Favicon
                    url={page!.url}
                    fallback={title.slice(0, 1)}
                    size={16}
                    radius={4}
                  />
                )}
                <View style={{ flex: 1 }}>
                  <Text
                    numberOfLines={1}
                    maxFontSizeMultiplier={1.35}
                    style={{ color: t.ink, fontSize: font.bodyPlus }}
                  >
                    {title}
                  </Text>
                  {page && (
                    <Text
                      numberOfLines={1}
                      maxFontSizeMultiplier={1.35}
                      style={{ color: t.inkMuted, fontSize: 11 }}
                    >
                      {page.tabId ? tr("address.switchTab") : page.url}
                    </Text>
                  )}
                </View>
                {highlight === index && (
                  <Text style={{ color: t.inkMuted, fontSize: 11 }}>↵</Text>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
});
