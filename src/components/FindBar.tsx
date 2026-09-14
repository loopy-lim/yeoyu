import React, { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { font, radius, size, space } from "../theme";
import { useTheme } from "../themeContext";

// Round 28dp hit target for the strip's glyph buttons; pressed opacity is
// applied per-Pressable.
const roundButton = {
  width: size.iconButton,
  height: size.iconButton,
  borderRadius: radius.control,
  alignItems: "center" as const,
  justifyContent: "center" as const,
};

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
  const [query, setQuery] = useState("");
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => onFind(query), 250);
    return () => clearTimeout(timer);
  }, [query]);
  return (
    <View
      style={{
        position: "absolute",
        top: space.md,
        alignSelf: "center",
        zIndex: 30,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingHorizontal: space.lg,
        height: size.input,
        borderRadius: radius.tile,
        backgroundColor: t.white,
        shadowColor: t.ringShadow,
        shadowOpacity: 0.2,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 8,
      }}
    >
      <TextInput
        ref={input}
        accessibilityLabel="Find in page"
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={() => onStep(false)}
        autoCapitalize="none"
        autoCorrect={false}
        disableFullscreenUI
        placeholder="Find in page"
        placeholderTextColor={t.inkFaint}
        style={{
          width: 200,
          height: size.address,
          paddingHorizontal: space.xl,
          borderRadius: radius.control,
          backgroundColor: t.sunken,
          color: t.ink,
          fontSize: font.bodyPlus,
        }}
      />
      <Text style={{ color: t.inkFaint, fontSize: font.small, minWidth: 34 }}>
        {result ? `${result.current + 1}/${result.total}` : ""}
      </Text>
      {(
        [
          ["Previous match", "‹", true],
          ["Next match", "›", false],
        ] as const
      ).map(([label, symbol, backward]) => (
        <Pressable
          key={label}
          accessibilityRole="button"
          accessibilityLabel={label}
          onPress={() => onStep(backward)}
          style={({ pressed }) => [
            roundButton,
            { opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Text style={{ color: t.icon, fontSize: font.icon, fontWeight: "600" }}>
            {symbol}
          </Text>
        </Pressable>
      ))}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close find"
        onPress={onClose}
        style={({ pressed }) => [
          roundButton,
          { opacity: pressed ? 0.6 : 1 },
        ]}
      >
        <Text style={{ color: t.icon, fontSize: font.icon }}>×</Text>
      </Pressable>
    </View>
  );
}
