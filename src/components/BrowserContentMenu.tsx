import React, { useRef, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { cn } from "@/ui/cn";
import { useReducedMotion } from "@/chrome/useReducedMotion";
import type { BrowserContentRequest, ContentAction } from "@/hooks/useBrowserWorkflows";
import { useI18n } from "@/i18nContext";

export function BrowserContentMenu({ request, onClose, onChoose }: {
  request: BrowserContentRequest | null;
  onClose(): void;
  onChoose(requestId: string, target: "link" | "image", action: ContentAction): Promise<void>;
}) {
  const { tr } = useI18n();
  const reducedMotion = useReducedMotion();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const choose = (target: "link" | "image", action: ContentAction) => {
    if (!request || busy.current) return;
    busy.current = true; setPending(true);
    void onChoose(request.requestId, target, action).finally(() => { busy.current = false; setPending(false); });
  };
  return <Modal transparent visible={request !== null} animationType={reducedMotion ? "none" : "fade"} onRequestClose={onClose}>
    <View className="flex-1 bg-scrim justify-center items-center p-[20px]">
      <View accessibilityViewIsModal className="w-full max-w-[480px] max-h-[80%] rounded-dialog p-[18px] bg-surface-elevated">
        <Text accessibilityRole="header" numberOfLines={2} className="text-ink text-title font-bold">{request?.title || tr("content.page")}</Text>
        <ScrollView>{(["link", "image"] as const).map((target) => {
          const url = target === "link" ? request?.linkUri : request?.imageUri;
          if (!url) return null;
          return <View key={target} className="mt-xxl">
            <Text numberOfLines={2} className="text-ink-muted text-body-plus">{url}</Text>
            {(["open", "copy", "share"] as const).map((action) => <Pressable key={action} accessibilityRole="button" disabled={pending} accessibilityState={{ disabled: pending }} onPress={() => choose(target, action)} className={cn("min-h-input justify-center")}>
              <Text className="text-ink text-input">{tr(`content.${action}`, { target: tr(target === "link" ? "content.link" : "content.image") })}</Text>
            </Pressable>)}
          </View>;
        })}</ScrollView>
        <Pressable accessibilityRole="button" onPress={onClose} className={cn("min-h-input justify-center")}><Text className="text-ink-muted text-input">{tr("common.cancel")}</Text></Pressable>
      </View>
    </View>
  </Modal>;
}
