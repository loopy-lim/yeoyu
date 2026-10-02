import React, { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { cn } from "@/ui/cn";
import { controlVariants, textVariants } from "@/ui/variants";
import { useTheme } from "@/themeContext";
import { useI18n } from "@/i18nContext";

// In-page find strip pinned to the top of the content card. Debounces the
// query into the native Gecko finder and shows current/total matches.
export function FindBar({
  onFind,
  onStep,
  onClose,
  result,
}: {
  onFind: (text: string) => void;
  onStep: (backward: boolean) => void;
  onClose: () => void;
  result: { current: number; total: number } | null;
}) {
  const t = useTheme();
  const { tr } = useI18n();
  const [query, setQuery] = useState("");
  const canStep = query.trim() !== "" && result?.total !== 0;
  const step = (backward: boolean) => {
    if (canStep) onStep(backward);
  };
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => onFind(query), 250);
    return () => clearTimeout(timer);
  }, [query]);
  return (
    <View className="absolute top-md self-center w-[94%] max-w-[400px] z-30 flex-row items-center gap-md px-lg h-input rounded-tile bg-white shadow-find-bar">
      <TextInput
        ref={input}
        accessibilityLabel={tr("find.inPage")}
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={() => step(false)}
        autoCapitalize="none"
        autoCorrect={false}
        disableFullscreenUI
        placeholder={tr("find.inPage")}
        placeholderTextColor={t.inkFaint}
        className="flex-1 min-w-0 h-address px-xl rounded-control bg-sunken text-ink text-body-plus"
      />
      <Text
        accessibilityLiveRegion="polite"
        numberOfLines={1}
        maxFontSizeMultiplier={1.35}
        className={cn(
          "min-w-address",
          textVariants({ size: "small", tone: "faint" })
        )}
      >
        {result
          ? `${result.current}/${result.total < 0 ? "?" : result.total}`
          : ""}
      </Text>
      {(
        [
          ["find.previous", "‹", true],
          ["find.next", "›", false],
        ] as const
      ).map(([label, symbol, backward]) => (
        <Pressable
          key={label}
          accessibilityRole="button"
          accessibilityLabel={tr(label)}
          accessibilityState={{ disabled: !canStep }}
          disabled={!canStep}
          hitSlop={8}
          onPress={() => step(backward)}
          className={cn(
            controlVariants({ disabled: !canStep }),
            canStep && "active:opacity-pressed"
          )}
        >
          <Text
            className={textVariants({
              size: "icon",
              tone: "icon",
              weight: "semibold",
            })}
          >
            {symbol}
          </Text>
        </Pressable>
      ))}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={tr("find.close")}
        hitSlop={8}
        onPress={onClose}
        className={cn(controlVariants(), "active:opacity-pressed")}
      >
        <Text className={textVariants({ size: "icon", tone: "icon" })}>×</Text>
      </Pressable>
    </View>
  );
}
