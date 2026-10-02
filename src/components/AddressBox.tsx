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
import { Favicon } from "@/components/Favicon";
import { ChromeIcon } from "@/chrome/ChromeIcon";
import { josaRo } from "@/i18n";
import {
  normalizeInput,
  suggest,
  type SearchEngineId,
  type Suggestion,
} from "@/suggestions";
import { matchingCommands, type ProductCommand } from "@/commandRegistry";
import type { HistoryEntry } from "@/history";
import { platform } from "@/platform";
import { cn } from "@/ui/cn";
import { rowVariants, textVariants } from "@/ui/variants";
import { useTheme } from "@/themeContext";
import { useI18n } from "@/i18nContext";

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
const resultKey = (result: Result) =>
  result.kind === "command"
    ? `command:${result.command.id}`
    : `page:${result.page.source}:${result.page.url}`;

/** URL/search, existing tabs and product commands share one keyboard selection model. */
export const AddressBox = forwardRef<
  React.ComponentRef<typeof TextInput>,
  Props
>((props, ref) => {
  const t = useTheme();
  const { tr } = useI18n();
  const [query, setQuery] = useState(props.value ?? "");
  const [focused, setFocused] = useState(false);
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  // Native key events can arrive together before React commits a render.
  const selectedKey = useRef<string | null>(null);
  const updateSelection = (key: string | null) => {
    selectedKey.current = key;
    setHighlightedKey(key);
  };
  const inputRef = useRef<React.ComponentRef<typeof TextInput> | null>(null);
  const resultsRef = useRef<React.ComponentRef<typeof ScrollView> | null>(null);
  const rowBounds = useRef(new Map<string, { y: number; height: number }>());
  const viewportHeight = useRef(0);
  const scrollOffset = useRef(0);
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
  const highlight = results.findIndex(
    (result) => resultKey(result) === highlightedKey
  );
  const revealSelection = (index: number) => {
    const result = results[index];
    const bounds = result && rowBounds.current.get(resultKey(result));
    const height = viewportHeight.current;
    if (!bounds || height <= 0) return;
    const top = scrollOffset.current;
    const bottom = bounds.y + bounds.height;
    const next =
      bounds.y < top ? bounds.y : bottom > top + height ? bottom - height : top;
    if (next === top) return;
    scrollOffset.current = Math.max(0, next);
    resultsRef.current?.scrollTo({
      y: scrollOffset.current,
      animated: !props.reducedMotion,
    });
  };
  useLayoutEffect(() => {
    const retained = new Set(results.map(resultKey));
    for (const key of rowBounds.current.keys()) {
      if (!retained.has(key)) rowBounds.current.delete(key);
    }
  }, [results]);
  useLayoutEffect(() => {
    if (!visible) {
      rowBounds.current.clear();
      viewportHeight.current = 0;
      scrollOffset.current = 0;
    }
  }, [visible]);
  useEffect(() => {
    if (visible) revealSelection(highlight);
  }, [highlight, visible, results]);
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
    const currentHighlight = results.findIndex(
      (result) => resultKey(result) === selectedKey.current
    );
    if (key === "ArrowDown")
      updateSelection(
        results[Math.min(currentHighlight + 1, results.length - 1)]
          ? resultKey(
              results[Math.min(currentHighlight + 1, results.length - 1)]
            )
          : null
      );
    else if (key === "ArrowUp")
      updateSelection(
        currentHighlight > 0 ? resultKey(results[currentHighlight - 1]) : null
      );
    else if (key === "Enter")
      select(currentHighlight >= 0 ? results[currentHighlight] : undefined);
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
    <View className="self-stretch min-h-0 shrink">
      <View className="flex-row items-center gap-xl px-xxl min-h-action-row rounded-tile bg-sunken">
        <ChromeIcon name="search" size={18} color={t.inkMuted} />
        <TextInput
          ref={setRefs}
          accessibilityLabel={tr("address.label")}
          maxFontSizeMultiplier={1.35}
          className="h-action-row flex-1 min-w-0 p-0 text-[15px] text-ink"
          value={query}
          onChangeText={(value) => {
            setQuery(value);
            updateSelection(null);
            scrollOffset.current = 0;
            resultsRef.current?.scrollTo({ y: 0, animated: false });
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
          onSubmitEditing={() => onKey("Enter")}
          onKeyPress={({ nativeEvent }) => {
            if (nativeEvent.key !== "Enter") onKey(nativeEvent.key);
          }}
        />
      </View>
      {visible && (
        <ScrollView
          ref={resultsRef}
          keyboardShouldPersistTaps="always"
          className="max-h-[340px] mt-md shrink"
          onLayout={({ nativeEvent }) => {
            viewportHeight.current = nativeEvent.layout.height;
            revealSelection(highlight);
          }}
          onScroll={({ nativeEvent }) => {
            scrollOffset.current = nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={16}
        >
          {results.map((result, index) => {
            const command = result.kind === "command" ? result.command : null;
            const page = result.kind === "page" ? result.page : null;
            const title = command?.title ?? page!.title;
            return (
              <Pressable
                key={resultKey(result)}
                accessibilityRole="button"
                accessibilityLabel={
                  command
                    ? title
                    : tr("address.go", { title, ro: josaRo(title) })
                }
                accessibilityState={{ selected: highlight === index }}
                onPress={() => select(result)}
                onLayout={({ nativeEvent }) => {
                  rowBounds.current.set(resultKey(result), nativeEvent.layout);
                  if (index === highlight) revealSelection(index);
                }}
                className={cn(
                  rowVariants({ density: "bookmark" }),
                  "px-xxl py-md rounded-[8px] gap-xl active:bg-sunken",
                  highlight === index && "bg-sunken"
                )}
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
                <View className="flex-1 min-w-0">
                  <Text
                    numberOfLines={1}
                    maxFontSizeMultiplier={1.35}
                    className={textVariants({ size: "bodyPlus" })}
                  >
                    {title}
                  </Text>
                  {page && (
                    <Text
                      numberOfLines={1}
                      maxFontSizeMultiplier={1.35}
                      className={textVariants({ tone: "muted" })}
                    >
                      {page.tabId ? tr("address.switchTab") : page.url}
                    </Text>
                  )}
                </View>
                {highlight === index && (
                  <Text className={textVariants({ tone: "muted" })}>↵</Text>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
});
