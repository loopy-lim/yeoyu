import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Badge } from "@unikit-bridge/ui";
import { cn } from "@/ui/cn";
import { appClasses as c } from "@/chrome/appStyles";
import { ChromeIcon } from "@/chrome/ChromeIcon";
import { FolderDisclosure } from "@/chrome/FolderDisclosure";
import { Favicon } from "@/components/Favicon";
import { useI18n } from "@/i18nContext";
import { countBookmarkNodes } from "@/sync/bookmarkTree";
import type { SyncErrorKind, SyncNode, SyncTree } from "@/sync/model";

/**
 * "Firefox" sidebar region for synced bookmarks (receive-only Phase 1):
 * the local-folders block visual language, minus close buttons, context
 * menus and drag — rows are read-only and open a normal tab. Collapsed by
 * default; the fold state is component state (persisting it is not in scope).
 */
export function SidebarSyncRegion({
  tree,
  syncing,
  errorKind,
  retryAfterSeconds,
  onOpenUrl,
}: {
  tree: SyncTree | null;
  syncing: boolean;
  errorKind: SyncErrorKind | null;
  retryAfterSeconds: number | null;
  onOpenUrl: (url: string) => void;
}) {
  const { tr } = useI18n();
  const [open, setOpen] = useState(false);
  if (!tree) return null;
  const count = countBookmarkNodes(tree);
  const status =
    syncing
      ? tr("sync.syncing")
      : errorKind
        ? tr(`sync.error.${errorKind}`)
        : count === 0
          ? tr("sync.empty")
          : null;
  return (
    <View className="mt-sm">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={tr("sync.sidebarHeader")}
        accessibilityState={{ expanded: open }}
        className={cn(c.spaceHeader, "active:opacity-pressed")}
        onPress={() => setOpen((value) => !value)}
      >
        <ChromeIcon
          className={cn("size-[11px]", "text-ink-faint")}
          name={open ? "chevronDown" : "chevronRight"}
        />
        <Text numberOfLines={1} className={c.spaceHeaderTitle}>
          {tr("sync.sidebarHeader")}
        </Text>
        {retryAfterSeconds !== null && !syncing && errorKind === "server" && (
          <Text className="text-ink-muted text-small">
            {tr("sync.error.backoff", {
              seconds: Math.max(1, Math.round(retryAfterSeconds)),
            })}
          </Text>
        )}
        <Badge
          variant="secondary"
          className="h-[18px] px-[6px] py-0 rounded-full bg-field-on-chrome border-transparent"
        >
          <Text className="text-ink-faint text-micro font-semibold tabular-nums">
            {count}
          </Text>
        </Badge>
      </Pressable>
      {status !== null && (
        <Text className="px-md pb-xs text-ink-faint text-small">{status}</Text>
      )}
      <FolderDisclosure open={open}>
        <View className={c.folderChildren}>
          {tree.roots.map((root) => (
            <SyncNodeRow key={root.guid} node={root} depth={0} onOpenUrl={onOpenUrl} />
          ))}
        </View>
      </FolderDisclosure>
    </View>
  );
}

function SyncNodeRow({
  node,
  depth,
  onOpenUrl,
}: {
  node: SyncNode;
  depth: number;
  onOpenUrl: (url: string) => void;
}) {
  const { tr } = useI18n();
  if (node.type === "separator") {
    // Hairline row — the separator glyph in the tree, no interaction.
    return <View className={cn(c.tab, "justify-center")} style={{ paddingLeft: 10 + depth * 12 }}>
      <View className="h-hairline-width flex-1 bg-hairline-on-chrome" />
    </View>;
  }
  if (node.type === "folder" || node.type === "livemark") {
    return (
      <View>
        <View
          accessibilityLabel={tr("sync.folderLabel", {
            name: node.title || tr("sync.untitledFolder"),
          })}
          className={cn(c.tab, "justify-center")}
          style={{ paddingLeft: 10 + depth * 12 }}
        >
          <View className="size-[20px] items-center justify-center">
            <ChromeIcon
              className={cn("size-[15px]", "text-icon")}
              name="folder"
            />
          </View>
          <Text numberOfLines={1} maxFontSizeMultiplier={1.35} className={cn(c.tabTitle, "text-ink-muted")}>
            {node.title || tr("sync.untitledFolder")}
          </Text>
        </View>
        {node.children?.map((child) => (
          <SyncNodeRow
            key={child.guid}
            node={child}
            depth={depth + 1}
            onOpenUrl={onOpenUrl}
          />
        ))}
      </View>
    );
  }
  const title = node.title || node.url || "";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tr("sync.bookmarkLabel", { name: title })}
      className={cn(c.tab, "active:bg-field-on-chrome")}
      style={{ paddingLeft: 10 + depth * 12 }}
      onPress={() => node.url && onOpenUrl(node.url)}
    >
      <View className={c.tabFavicon}>
        <Favicon
          url={node.url ?? ""}
          fallback={(title.slice(0, 1) || "•").toUpperCase()}
          size={14}
          radius={4}
        />
      </View>
      <Text numberOfLines={1} maxFontSizeMultiplier={1.35} className={cn(c.tabTitle, "text-ink-muted")}>
        {title}
      </Text>
    </Pressable>
  );
}
