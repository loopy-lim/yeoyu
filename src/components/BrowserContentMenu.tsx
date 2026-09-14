import React, { useRef, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useTheme } from "../themeContext";
import { useReducedMotion } from "../chrome/useReducedMotion";
import type { BrowserContentRequest, ContentAction } from "../hooks/useBrowserWorkflows";

export function BrowserContentMenu({ request, onClose, onChoose }: {
  request: BrowserContentRequest | null;
  onClose(): void;
  onChoose(requestId: string, target: "link" | "image", action: ContentAction): Promise<void>;
}) {
  const t = useTheme();
  const reducedMotion = useReducedMotion();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const choose = (target: "link" | "image", action: ContentAction) => {
    if (!request || busy.current) return;
    busy.current = true; setPending(true);
    void onChoose(request.requestId, target, action).finally(() => { busy.current = false; setPending(false); });
  };
  return <Modal transparent visible={request !== null} animationType={reducedMotion ? "none" : "fade"} onRequestClose={onClose}>
    <View style={{ flex: 1, backgroundColor: t.scrim, justifyContent: "center", alignItems: "center", padding: 20 }}>
      <View accessibilityViewIsModal style={{ width: "100%", maxWidth: 480, maxHeight: "80%", borderRadius: 18, padding: 18, backgroundColor: t.surfaceElevated }}>
        <Text accessibilityRole="header" numberOfLines={2} style={{ color: t.ink, fontSize: 18, fontWeight: "700" }}>{request?.title || "Page content"}</Text>
        <ScrollView>{(["link", "image"] as const).map((target) => {
          const url = target === "link" ? request?.linkUri : request?.imageUri;
          if (!url) return null;
          return <View key={target} style={{ marginTop: 12 }}>
            <Text numberOfLines={2} style={{ color: t.inkMuted, fontSize: 12 }}>{url}</Text>
            {(["open", "copy", "share"] as const).map((action) => <Pressable key={action} accessibilityRole="button" disabled={pending} accessibilityState={{ disabled: pending }} onPress={() => choose(target, action)} style={{ minHeight: 44, justifyContent: "center" }}>
              <Text style={{ color: t.ink, fontSize: 13 }}>{action === "open" ? `Open ${target} in new tab` : action === "copy" ? `Copy ${target} address` : `Share ${target}`}</Text>
            </Pressable>)}
          </View>;
        })}</ScrollView>
        <Pressable accessibilityRole="button" onPress={onClose} style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: t.inkMuted, fontSize: 13 }}>Cancel</Text></Pressable>
      </View>
    </View>
  </Modal>;
}
