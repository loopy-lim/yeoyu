import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Badge } from "@unikit-bridge/ui";
import { cn } from "@/ui/cn";
import { appClasses as c } from "@/chrome/appStyles";
import { ChromeIcon } from "@/chrome/ChromeIcon";
import { FolderDisclosure } from "@/chrome/FolderDisclosure";
import { Favicon } from "@/components/Favicon";
import { useI18n } from "@/i18nContext";
import type { SyncedDeviceTabs } from "@/sync/model";

/**
 * "Synced Tabs" sidebar region (receive-only): other devices' open tabs,
 * grouped per device, newest activity first. Rows open the tab's current
 * url; the region stays hidden until the first tabs fetch lands (null) and
 * collapses back when every device's list is empty.
 */
export function SidebarSyncedTabsRegion({
  devices,
  onOpenUrl,
}: {
  devices: SyncedDeviceTabs[] | null;
  onOpenUrl: (url: string) => void;
}) {
  const { tr } = useI18n();
  const [open, setOpen] = useState(false);
  if (!devices || devices.length === 0) return null;
  const tabCount = devices.reduce((sum, device) => sum + device.tabs.length, 0);
  if (tabCount === 0) return null;
  return (
    <View className="mt-sm">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={tr("sync.tabsHeader")}
        accessibilityState={{ expanded: open }}
        className={cn(c.spaceHeader, "active:opacity-pressed")}
        onPress={() => setOpen((value) => !value)}
      >
        <ChromeIcon
          className={cn("size-[11px]", "text-ink-faint")}
          name={open ? "chevronDown" : "chevronRight"}
        />
        <Text numberOfLines={1} className={c.spaceHeaderTitle}>
          {tr("sync.tabsHeader")}
        </Text>
        <Badge
          variant="secondary"
          className="h-[18px] px-[6px] py-0 rounded-full bg-field-on-chrome border-transparent"
        >
          <Text className="text-ink-faint text-micro font-semibold tabular-nums">
            {tabCount}
          </Text>
        </Badge>
      </Pressable>
      <FolderDisclosure open={open}>
        <View className={c.folderChildren}>
          {devices.map((device) => (
            <DeviceTabs
              key={device.clientId}
              device={device}
              onOpenUrl={onOpenUrl}
            />
          ))}
        </View>
      </FolderDisclosure>
    </View>
  );
}

function DeviceTabs({
  device,
  onOpenUrl,
}: {
  device: SyncedDeviceTabs;
  onOpenUrl: (url: string) => void;
}) {
  const { tr } = useI18n();
  if (device.tabs.length === 0) return null;
  return (
    <View>
      <View
        accessibilityLabel={tr("sync.tabsDeviceLabel", { name: device.clientName })}
        className={cn(c.tab, "justify-center")}
        style={{ paddingLeft: 10 }}
      >
        <View className="size-[20px] items-center justify-center">
          <ChromeIcon className={cn("size-[14px]", "text-icon")} name="sync" />
        </View>
        <Text numberOfLines={1} maxFontSizeMultiplier={1.35} className={cn(c.tabTitle, "text-ink-faint")}>
          {device.clientName}
        </Text>
      </View>
      {device.tabs.map((tab) => {
        const title = tab.title || tab.url;
        return (
          <Pressable
            key={`${tab.url}-${tab.lastUsedMs ?? 0}`}
            accessibilityRole="button"
            accessibilityLabel={tr("sync.tabLabel", { name: title })}
            className={cn(c.tab, "active:bg-field-on-chrome")}
            style={{ paddingLeft: 10 + 12 }}
            onPress={() => onOpenUrl(tab.url)}
          >
            <View className={c.tabFavicon}>
              <Favicon
                url={tab.icon ?? tab.url}
                fallback="globe"
                size={14}
                radius={4}
              />
            </View>
            <Text numberOfLines={1} maxFontSizeMultiplier={1.35} className={cn(c.tabTitle, "text-ink-muted")}>
              {title}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
