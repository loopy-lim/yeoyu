import { cva } from "class-variance-authority";
import { cn } from "@/ui/cn";
import React, { useRef, useState } from "react";
import { Alert, Pressable, Switch, Text, View } from "react-native";
import type { BrowserController } from "@/BrowserController";
import type { WorkArchivePreview } from "@generated/types";
import type { UiPreferences } from "@/uiPreferences";
import { portableFiles } from "@/portableFiles";
import {
  bookmarkHtmlToArchive,
  bookmarksToHtml,
  checkArchiveSize,
  parsePresentation,
  portablePresentation,
  type PortablePresentation,
} from "@/workArchive";
import { useTheme } from "@/themeContext";
import { useI18n } from "@/i18nContext";
import { HapticSwitch } from "@/chrome/HapticSwitch";

type Preview = {
  json: string;
  counts: WorkArchivePreview;
  presentation: PortablePresentation | null;
  shortcuts: string[];
  spaces: string[];
};
const c = {
  section: "mt-[20px] mb-md text-body-plus font-bold text-ink-muted",
  detail: "text-input-plus text-ink-muted leading-[21px]",
  text: "text-[15px] text-ink leading-[21px]",
  action:
    "min-h-action-row justify-center p-xxl rounded-[8px] bg-surface-elevated active:opacity-pressed",
  actions: "gap-lg my-lg",
  preview: "border border-ink-faint rounded-[8px] p-xxl gap-lg",
  row: "flex-row flex-wrap gap-xxl items-center min-h-action-row",
  grow: "flex-1 min-w-0",
} as const;
const actionClasses = cva(c.action, {
  variants: {
    disabled: { true: "opacity-50", false: "" },
  },
});

export function BrowserDataPanel({
  controller,
  ui,
  hydrated,
  onPresentation,
  onError,
  onNotice,
}: {
  controller: BrowserController;
  ui: UiPreferences;
  hydrated: boolean;
  onPresentation(value: PortablePresentation): Promise<void>;
  onError(message: string): void;
  onNotice(message: string): void;
}) {
  const t = useTheme();
  const { tr } = useI18n();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [favorites, setFavorites] = useState(true);
  const [keymap, setKeymap] = useState(false);
  const [presentation, setPresentation] = useState(false);
  const appearanceLabel = (value: UiPreferences["appearance"]) =>
    tr(value === "warm" ? "color.warm" : "color.lavender");
  const modeLabel = (value?: UiPreferences["colorMode"]) =>
    tr(
      value === "light"
        ? "color.light"
        : value === "dark"
        ? "color.dark"
        : "color.system"
    );
  const sourceLabel = (value?: UiPreferences["colorSource"]) =>
    tr(
      value === "custom"
        ? "color.sourceCustom"
        : value === "appearance"
        ? "color.sourceBase"
        : "color.sourceSpace"
    );
  const presentationDetails = (value: PortablePresentation) =>
    [
      `${tr("archive.appearance")}: ${appearanceLabel(
        ui.appearance
      )} → ${appearanceLabel(value.appearance)}`,
      `${tr("archive.colorMode")}: ${modeLabel(ui.colorMode)} → ${modeLabel(
        value.colorMode
      )}`,
      `${tr("archive.colorSource")}: ${sourceLabel(value.colorSource)}${
        value.colorSource === "custom" ? ` (${value.customColor})` : ""
      }`,
      `${tr("archive.sidebarWidth")}: ${ui.sidebarWidth} → ${
        value.sidebarWidth
      }`,
      `${tr("archive.sidebar")}: ${tr(
        value.sidebarCollapsed ? "archive.collapsed" : "archive.expanded"
      )}`,
      `${tr("archive.frame")}: ${tr("side.left")} ${value.framePx.left}, ${tr(
        "side.right"
      )} ${value.framePx.right}, ${tr("side.top")} ${value.framePx.top}, ${tr(
        "side.bottom"
      )} ${value.framePx.bottom} px`,
    ].join("\n");
  const perform = (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    void action()
      .catch((error) =>
        onError(
          tr("archive.error", {
            detail: error instanceof Error ? error.message : "",
          })
        )
      )
      .finally(() => {
        lock.current = false;
        setBusy(false);
      });
  };
  const button = (label: string, onPress: () => void, unavailable = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy || !hydrated || unavailable }}
      disabled={busy || !hydrated || unavailable}
      className={cn(
        actionClasses({ disabled: busy || !hydrated || unavailable })
      )}
      onPress={onPress}
    >
      <Text className={c.text}>{label}</Text>
    </Pressable>
  );
  const exportFile = (html: boolean) =>
    Alert.alert(
      tr(html ? "archive.exportBookmarksTitle" : "archive.exportWorkTitle"),
      tr("archive.exportWarning"),
      [
        { text: tr("common.cancel"), style: "cancel" },
        {
          text: tr("archive.chooseDestination"),
          onPress: () =>
            perform(async () => {
              if (!portableFiles) throw new Error(tr("archive.unavailable"));
              const archive = await controller.exportArchive(
                html ? null : portablePresentation(ui)
              );
              const result = await portableFiles.chooseExport(
                html ? bookmarksToHtml(archive) : archive,
                html
              );
              if (result)
                onNotice(
                  tr(
                    html ? "archive.bookmarksExported" : "archive.workExported"
                  )
                );
            }),
        },
      ]
    );
  const readImportPreview = async () => {
    if (!portableFiles) throw new Error(tr("archive.unavailable"));
    const contents = await portableFiles.chooseImport();
    if (contents === null) return;
    setPreview(null);
    const raw = contents.replace(/^\uFEFF/, "").trim();
    checkArchiveSize(raw);
    const json = raw.startsWith("{") ? raw : bookmarkHtmlToArchive(raw);
    const counts = await controller.previewArchive(json);
    let parsedPresentation: PortablePresentation | null;
    try {
      parsedPresentation = parsePresentation(counts.presentation ?? null);
    } catch {
      throw new Error(tr("archive.unsupportedAppearance"));
    }
    const archive = JSON.parse(json);
    const shortcuts = (
      archive.keyBindings as {
        key: string;
        meta: boolean;
        ctrl: boolean;
        alt: boolean;
        shift: boolean;
        command: string;
      }[]
    ).map(
      (k) =>
        [
          k.meta && "Meta",
          k.ctrl && "Ctrl",
          k.alt && "Alt",
          k.shift && "Shift",
          k.key,
        ]
          .filter(Boolean)
          .join("+") +
        " → " +
        k.command
    );
    setPreview({
      json,
      counts,
      presentation: parsedPresentation,
      shortcuts,
      spaces: archive.spaces.map((v: { name: string }) => v.name),
    });
    setFavorites(true);
    setKeymap(false);
    setPresentation(false);
  };
  const chooseImport = () => perform(readImportPreview);
  const commitImport = async (selected: Preview) => {
    await controller.importArchive(selected.json, favorites, keymap);
    // Clear the preview once data is committed; a failed appearance write
    // must never invite retrying the entire append and duplicating Spaces.
    setPreview(null);
    if (presentation && selected.presentation) {
      try {
        await onPresentation(selected.presentation);
      } catch {
        throw new Error(tr("archive.appearanceFailed"));
      }
    }
    onNotice(tr("archive.imported"));
  };
  const applyImport = () => {
    if (!preview) return;
    const selected = preview;
    Alert.alert(
      tr("archive.importTitle"),
      tr("archive.importWarning") +
        (keymap ? tr("archive.replaceKeysWarning") : "") +
        (presentation ? tr("archive.appearanceWarning") : ""),
      [
        { text: tr("common.cancel"), style: "cancel" },
        {
          text: tr("archive.import"),
          onPress: () => perform(() => commitImport(selected)),
        },
      ]
    );
  };
  return (
    <>
      <Text className={c.section}>{tr("archive.title")}</Text>
      <Text className={c.detail}>{tr("archive.help")}</Text>
      <View className={c.actions}>
        {button(tr("archive.exportHtml"), () => exportFile(true))}
        {button(tr("archive.exportWork"), () => exportFile(false))}
        {button(tr("archive.chooseImport"), chooseImport)}
      </View>
      {preview && (
        <View className={c.preview}>
          <Text accessibilityRole="header" className={c.text}>
            {tr("archive.preview")}
          </Text>
          <Text className={c.detail}>
            {tr("archive.counts", {
              spaces: preview.counts.spaces,
              tabs: preview.counts.tabs,
              bookmarks: preview.counts.bookmarks,
              folders: preview.counts.folders,
            })}
          </Text>
          <Text className={c.detail}>
            {tr("archive.duplicates", { count: preview.counts.duplicateUrls })}
          </Text>
          <Text className={c.detail}>
            {preview.spaces.slice(0, 20).join(", ")}
            {preview.spaces.length > 20
              ? tr("archive.moreSpaces", { count: preview.spaces.length - 20 })
              : ""}
          </Text>
          {preview.counts.favorites > 0 && (
            <View className={c.row}>
              <Text className={cn(c.text, c.grow)}>
                {tr("archive.addFavorites", {
                  count: preview.counts.favorites,
                })}
              </Text>
              <HapticSwitch
                trackColor={{ false: t.switchOff, true: t.accent }}
                thumbColor={t.surfaceElevated}
                accessibilityLabel={tr("archive.addFavoritesLabel")}
                disabled={busy}
                value={favorites}
                onValueChange={setFavorites}
              />
            </View>
          )}
          {preview.counts.hasKeyBindings && (
            <>
              <View className={c.row}>
                <Text className={cn(c.text, c.grow)}>
                  {tr("archive.replaceKeys")}
                </Text>
                <HapticSwitch
                  trackColor={{ false: t.switchOff, true: t.accent }}
                  thumbColor={t.surfaceElevated}
                  accessibilityLabel={tr("archive.replaceKeys")}
                  disabled={busy}
                  value={keymap}
                  onValueChange={setKeymap}
                />
              </View>
              {keymap && (
                <Text className={c.detail}>
                  {preview.shortcuts.slice(0, 30).join("\n")}
                  {preview.shortcuts.length > 30
                    ? `\n${tr("archive.moreKeys", {
                        count: preview.shortcuts.length - 30,
                      })}`
                    : ""}
                </Text>
              )}
            </>
          )}
          {preview.presentation && (
            <>
              <View className={c.row}>
                <Text className={cn(c.text, c.grow)}>
                  {tr("archive.applyAppearance")}
                </Text>
                <HapticSwitch
                  trackColor={{ false: t.switchOff, true: t.accent }}
                  thumbColor={t.surfaceElevated}
                  accessibilityLabel={tr("archive.applyAppearance")}
                  disabled={busy}
                  value={presentation}
                  onValueChange={setPresentation}
                />
              </View>
              {presentation && (
                <Text className={c.detail}>
                  {presentationDetails(preview.presentation)}
                </Text>
              )}
            </>
          )}
          {button(tr("archive.add"), applyImport)}
          {button(tr("archive.cancelImport"), () => setPreview(null))}
        </View>
      )}
    </>
  );
}
