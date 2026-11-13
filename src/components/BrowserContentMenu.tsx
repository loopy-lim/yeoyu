import React, { useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { DialogCard } from "@/components/DialogCard";
import { PortalModal } from "@/components/PortalModal";
import { cn } from "@/ui/cn";
import type { BrowserContentRequest, ContentAction } from "@/hooks/useBrowserWorkflows";
import { useI18n } from "@/i18nContext";

export function BrowserContentMenu({ request, sourcePrivate, onClose, onChoose }: {
  request: BrowserContentRequest | null;
  sourcePrivate?: boolean;
  onClose(): void;
  onChoose(requestId: string, target: "link" | "image", action: ContentAction): Promise<void>;
}) {
  const { tr } = useI18n();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const choose = (target: "link" | "image", action: ContentAction) => {
    if (!request || busy.current) return;
    busy.current = true; setPending(true);
    void onChoose(request.requestId, target, action).finally(() => { busy.current = false; setPending(false); });
  };
  return (
    <PortalModal visible={request !== null} onClose={onClose}>
      <DialogCard variant="modal">
        <Text accessibilityRole="header" numberOfLines={2} className="text-ink text-title font-bold">{request?.title || tr("content.page")}</Text>
        <ScrollView>{(["link", "image"] as const).map((target) => {
          const url = target === "link" ? request?.linkUri : request?.imageUri;
          if (!url) return null;
          // Chrome-parity item set: open (new tab), open in private tab
          // (non-private sources only), download, copy address, share.
          const actions = (sourcePrivate
            ? (["open", "download", "copy", "share"] as const)
            : (["open", "privateOpen", "download", "copy", "share"] as const)
          ).filter((action) => target === "link" || action !== "privateOpen");
          return <View key={target} className="mt-xxl">
            <Text numberOfLines={2} className="text-ink-muted text-body-plus">{url}</Text>
            {actions.map((action) => <Pressable key={action} accessibilityRole="button" disabled={pending} accessibilityState={{ disabled: pending }} onPress={() => choose(target, action)} className={cn("min-h-input justify-center")}>
              <Text className="text-ink text-input">{action === "privateOpen" ? tr("content.privateOpen") : tr(`content.${action}`, { target: tr(target === "link" ? "content.link" : "content.image") })}</Text>
            </Pressable>)}
          </View>;
        })}</ScrollView>
        <Pressable accessibilityRole="button" onPress={onClose} className={cn("min-h-input justify-center")}><Text className="text-ink-muted text-input">{tr("common.cancel")}</Text></Pressable>
      </DialogCard>
    </PortalModal>
  );
}
