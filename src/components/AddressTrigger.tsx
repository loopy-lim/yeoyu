import React from "react";
import { Text, View } from "react-native";
import { SidebarPressable as Pressable } from "@/chrome/SidebarInteraction";
import { cn } from "@/ui/cn";
import { textVariants } from "@/ui/variants";
import { ChromeIcon, type IconName } from "@/chrome/ChromeIcon";
import { useTheme } from "@/themeContext";
import { useI18n } from "@/i18nContext";
import { sidebarAddressLabel } from "@/sidebarModel";
import { size } from "@/theme";
import { hitSlopForTarget } from "@/touchTargets";
import { useTierSizes } from "@/ui/ThemeScope";
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
  const sizes = useTierSizes();
  const compactTier = sizes.addressCompact > size.addressCompact;
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
      hitSlop={hitSlopForTarget(
        compact ? sizes.addressCompact : sizes.address
      )}
      onPress={onPress}
      className={cn(
        "justify-center rounded-[9px] active:opacity-pressed",
        compact
          ? cn(
              "flex-1 h-address-compact bg-sunken border border-hairline",
              compactTier ? "px-md" : "px-lg ml-sm"
            )
          : "self-stretch h-address px-lg bg-field-on-chrome border border-transparent"
      )}
    >
      <View
        className={cn(
          "flex-row items-center",
          compact && compactTier ? "gap-sm" : "gap-md"
        )}
      >
        {shieldGlyph && (
          <ChromeIcon
            name={shieldGlyph}
            size={13}
            color={shieldGlyph === "warning" ? t.errorInk : t.inkFaint}
          />
        )}
        {empty && <ChromeIcon name="search" size={13} color={t.inkFaint} />}
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={1.35}
          className={cn(
            "flex-1 font-medium",
            textVariants({ size: "body", tone: empty ? "faint" : "ink" })
          )}
        >
          {empty ? tr("address.placeholder") : label}
        </Text>
      </View>
    </Pressable>
  );
}
