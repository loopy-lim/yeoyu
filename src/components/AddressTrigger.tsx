import React from "react";
import { Text, View } from "react-native";
import { SidebarPressable as Pressable } from "@/chrome/SidebarInteraction";
import { cn } from "@/ui/cn";
import { textVariants } from "@/ui/variants";
import { ChromeIcon, type IconName } from "@/chrome/ChromeIcon";
import { useTheme } from "@/themeContext";
import { useI18n } from "@/i18nContext";
import { sidebarAddressLabel } from "@/sidebarModel";
import type { BrowserSecurity } from "@/hooks/useBrowserWorkflows";

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
  const label = sidebarAddressLabel(url);
  const empty = label === "";
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
      className={cn(
        "justify-center rounded-control px-xl active:opacity-pressed",
        compact
          ? "flex-1 h-address-compact ml-sm bg-sunken"
          : "self-stretch h-address bg-field-on-chrome"
      )}
    >
      <View className="flex-row items-center gap-lg">
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
          className={cn(
            "flex-1",
            textVariants({ size: "input", tone: empty ? "faint" : "ink" })
          )}
        >
          {empty ? tr("address.placeholder") : label}
        </Text>
      </View>
    </Pressable>
  );
}
