import React from "react";
import { Text, View } from "react-native";
import { SidebarPressable as Pressable } from "../chrome/SidebarInteraction";
import { alpha, font, radius, size, space } from "../theme";
import { ChromeIcon, type IconName } from "../chrome/ChromeIcon";
import { useTheme } from "../themeContext";
import { useI18n } from "../i18nContext";
import type { BrowserSecurity } from "../hooks/useBrowserWorkflows";

export type AddressShield = "secure" | "attention" | "loading";

/** Same trust read as the site-info panel: known-secure locks, exceptions,
 *  mixed content or plain http raise attention, everything else is loading. */
export function addressShield(
  url: string,
  security: BrowserSecurity | undefined
): AddressShield | null {
  if (url === "") return null;
  const origin = originOf(url);
  if (!security || security.origin !== origin) return null;
  if (security.known === false) return "loading";
  if (!security.secure || security.exception || security.mixedActive)
    return "attention";
  return "secure";
}

/** Matches the site-info panel's origin derivation (URL.origin). */
function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.origin : null;
  } catch {
    return null;
  }
}

// Display-only address pill for the sidebar nav row and the compact
// toolbar. It never takes text input: tapping it (like ⌘L) opens the
// centered editor dialog, the single input surface for addresses.
export function AddressTrigger({
  url,
  compact = false,
  security,
  onPress,
}: {
  url: string;
  compact?: boolean;
  security?: BrowserSecurity;
  onPress: () => void;
}) {
  const t = useTheme();
  const { tr } = useI18n();
  const empty = url === "";
  const shield = addressShield(url, security);
  const shieldGlyph: IconName | null =
    shield === "secure" ? "lock" : shield === "attention" ? "warning" : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tr("address.edit")}
      accessibilityHint={
        empty
          ? tr("address.editHintEmpty")
          : tr("address.editHintSite", { url })
      }
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        compact
          ? {
              flex: 1,
              height: size.addressCompact,
              marginLeft: space.sm,
              paddingHorizontal: space.xl,
              borderRadius: radius.control,
              backgroundColor: t.sunken,
              justifyContent: "center",
            }
          : {
              // alignSelf stretch, not flex:1 — the trigger lives in the
              // sidebar's auto-height column now, where a flex basis of 0
              // would collapse it to nothing.
              alignSelf: "stretch",
              height: size.address,
              paddingHorizontal: space.xl,
              borderRadius: radius.control,
              backgroundColor: t.fieldOnChrome,
              justifyContent: "center",
            },
        pressed && { opacity: alpha.pressed },
      ]}
    >
      <View
        style={{ flexDirection: "row", alignItems: "center", gap: space.lg }}
      >
        {shieldGlyph && (
          <ChromeIcon
            name={shieldGlyph}
            size={15}
            color={shieldGlyph === "warning" ? t.errorInk : t.inkMuted}
          />
        )}
        {empty && <ChromeIcon name="search" size={15} color={t.inkMuted} />}
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={1.35}
          style={[
            {
              flex: 1,
              color: t.ink,
              fontSize: font.input,
            },
            empty && { color: t.inkFaint },
          ]}
        >
          {empty ? tr("address.placeholder") : url}
        </Text>
      </View>
    </Pressable>
  );
}
