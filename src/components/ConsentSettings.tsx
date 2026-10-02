import { cva } from "class-variance-authority";
import { cn } from "@/ui/cn";
import React, { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { appClasses as c } from "@/chrome/appStyles";
import { ChromeIcon } from "@/chrome/ChromeIcon";
import { useI18n } from "@/i18nContext";
import {
  ANDROID_PERMISSION_KINDS,
  type AndroidPermissionKind,
  type ConsentRuntime,
} from "@/consent";
import { useConsentPermissions } from "@/hooks/useConsentPermissions";
import { platform } from "@/platform";
import type { SitePermission, PermissionDecision } from "@/permissions";
import type { PermissionKind } from "@/uiPreferences";

interface Props {
  rules: SitePermission[];
  onRevoke: (origin: string, kind: PermissionKind) => Promise<void>;
  onClearAll: () => Promise<void>;
  siteUrl?: string;
  privateSite?: boolean;
  onAutoplayChange?: (
    origin: string,
    decision: PermissionDecision | null
  ) => Promise<void>;
}
const runtime = platform as ConsentRuntime;
interface ActionFeedback {
  target: string;
  message: string;
  busy?: boolean;
  error?: boolean;
}

const actionState = cva("active:opacity-pressed", {
  variants: {
    disabled: { true: "opacity-disabled", false: "" },
    selected: { true: "bg-sunken-strong border-accent", false: "" },
  },
});

/** Preparing Android access never grants a website access to the device. */
export function ConsentSettings({
  rules,
  onRevoke,
  onClearAll,
  siteUrl,
  privateSite,
  onAutoplayChange,
}: Props) {
  const { tr } = useI18n();
  const android = useConsentPermissions(runtime);
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const busy = feedback?.busy ?? false;
  const [details, setDetails] = useState(false);
  const running = useRef(false);
  const groups = new Map<string, SitePermission[]>();
  for (const rule of rules)
    groups.set(rule.origin, [...(groups.get(rule.origin) ?? []), rule]);
  let currentOrigin: string | null = null;
  try {
    const url = new URL(siteUrl ?? "");
    if (!privateSite && (url.protocol === "https:" || url.protocol === "http:"))
      currentOrigin = url.origin;
  } catch {
    /* A blank or internal page has no site choice. */
  }
  const autoplay =
    rules.find(
      (rule) => rule.origin === currentOrigin && rule.kind === "autoplay"
    )?.decision ?? "default";

  const perform = async (
    operation: () => Promise<void | string>,
    success?: string,
    target = "saved"
  ) => {
    if (running.current) return;
    running.current = true;
    setFeedback({ target, message: tr("consent.updating"), busy: true });
    try {
      const result = await operation();
      const message = result || success;
      setFeedback(message ? { target, message } : null);
    } catch (failure) {
      setFeedback({
        target,
        error: true,
        message: tr("consent.updateError", {
          detail: failure instanceof Error ? failure.message : "",
        }),
      });
    } finally {
      running.current = false;
    }
  };
  const prepareAccess = (kind: AndroidPermissionKind) =>
    perform(
      async () => {
        const request = runtime.requestAndroidPermission;
        if (!request) return;
        try {
          const allowed = await request.call(runtime, kind);
          if (!allowed) return tr("consent.deniedHelp");
        } finally {
          await android.refresh();
        }
      },
      undefined,
      kind
    );

  return (
    <View className={c.consentPage}>
      <View className={c.consentIntro}>
        <ChromeIcon name="check" size={20} />
        <View className={c.consentCopy}>
          <Text className={c.optionTitle}>{tr("consent.basic")}</Text>
          <Text className={c.optionDescription}>{tr("consent.basicHelp")}</Text>
        </View>
      </View>

      <View>
        <Text
          accessibilityRole="header"
          className={cn(c.settingsSection, "mt-0")}
        >
          {tr("consent.deviceTitle")}
        </Text>
        <Text className={c.optionDescription}>{tr("consent.deviceHelp")}</Text>
        <View className={c.consentGroup}>
          {ANDROID_PERMISSION_KINDS.map((kind) => {
            const status = android.status[kind];
            const granted = status === "allowed" || status === "approximate";
            const label = tr(`consent.kind.${kind}`);
            return (
              <View key={kind} className={c.consentRow}>
                <View className={c.consentCopy}>
                  <Text className={c.optionTitle}>{label}</Text>
                  <Text className={c.optionDescription}>
                    {tr(`consent.purpose.${kind}`)}
                  </Text>
                  <Text className={c.consentStatus}>
                    {android.loading
                      ? tr("consent.checking")
                      : tr(
                          status === "allowed"
                            ? "consent.ready"
                            : status === "approximate"
                            ? "consent.approximate"
                            : status === "unknown"
                            ? "consent.unknown"
                            : "consent.notReady"
                        )}
                  </Text>
                </View>
                {granted ? (
                  <ChromeIcon name="check" size={20} />
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={tr("consent.grantLabel", {
                      kind: label,
                    })}
                    accessibilityState={{
                      disabled:
                        busy ||
                        android.loading ||
                        !runtime.requestAndroidPermission,
                    }}
                    disabled={
                      busy ||
                      android.loading ||
                      !runtime.requestAndroidPermission
                    }
                    className={cn(
                      c.consentButton,
                      actionState({
                        disabled:
                          busy ||
                          android.loading ||
                          !runtime.requestAndroidPermission,
                      })
                    )}
                    onPress={() => void prepareAccess(kind)}
                  >
                    <Text className={c.optionTitle}>{tr("consent.grant")}</Text>
                  </Pressable>
                )}
                <ConsentFeedback feedback={feedback} target={kind} />
              </View>
            );
          })}
        </View>
        <ConsentAction
          title={tr("consent.android")}
          description={tr("consent.androidDetail")}
          disabled={busy || !runtime.openAndroidPermissionSettings}
          onPress={() => {
            const open = runtime.openAndroidPermissionSettings;
            if (open)
              void perform(() => open.call(runtime), undefined, "android");
          }}
        />
        {!runtime.openAndroidPermissionSettings && (
          <Text className={c.optionDescription}>
            {tr("consent.androidManual")}
          </Text>
        )}
        {android.error && (
          <>
            <Text accessibilityRole="alert" className={c.optionDescription}>
              {tr("consent.androidError", { detail: android.error })}
            </Text>
            <ConsentAction
              title={tr("consent.checkAgain")}
              disabled={android.loading}
              onPress={() => void android.refresh()}
            />
          </>
        )}
        <ConsentFeedback feedback={feedback} target="android" />
      </View>

      <View className={c.consentIntro}>
        <ChromeIcon name="play" size={20} />
        <View className={c.consentCopy}>
          <Text className={c.optionTitle}>{tr("consent.defaults")}</Text>
          <Text className={c.optionDescription}>
            {tr("consent.defaultsHelp")}
          </Text>
        </View>
      </View>
      {currentOrigin && onAutoplayChange && (
        <View>
          <Text className={c.optionTitle}>{tr("consent.siteAutoplay")}</Text>
          <Text selectable className={c.optionDescription}>
            {currentOrigin}
          </Text>
          <View className={c.consentChoices}>
            {(["default", "allow", "block"] as const).map((choice) => (
              <Pressable
                key={choice}
                accessibilityRole="radio"
                accessibilityLabel={tr(`consent.autoplay.${choice}`)}
                accessibilityState={{
                  checked: autoplay === choice,
                  disabled: busy,
                }}
                disabled={busy}
                className={cn(
                  c.consentChoice,
                  autoplay === choice && c.consentChoiceSelected,
                  actionState({ disabled: busy })
                )}
                onPress={() => {
                  const origin = currentOrigin;
                  if (origin)
                    void perform(
                      () =>
                        onAutoplayChange(
                          origin,
                          choice === "default" ? null : choice
                        ),
                      tr("consent.autoplaySaved"),
                      "autoplay"
                    );
                }}
              >
                {autoplay === choice && <ChromeIcon name="check" size={16} />}
                <Text className={c.optionTitle}>
                  {tr(`consent.autoplay.${choice}`)}
                </Text>
              </Pressable>
            ))}
          </View>
          <ConsentFeedback feedback={feedback} target="autoplay" />
        </View>
      )}

      <View>
        <Text
          accessibilityRole="header"
          className={cn(c.settingsSection, "mt-0")}
        >
          {tr("consent.saved")}
        </Text>
        <Text className={c.optionDescription}>
          {rules.length
            ? tr("consent.savedCount", { count: rules.length })
            : tr("consent.empty")}
        </Text>
        {[...groups].map(([origin, siteRules]) => (
          <View key={origin} className={c.consentGroup}>
            <Text selectable className={c.consentOrigin}>
              {origin}
            </Text>
            {siteRules.map((rule) => (
              <View key={rule.kind} className={c.consentRow}>
                <View className={c.consentCopy}>
                  <Text className={c.optionTitle}>
                    {tr(`consent.kind.${rule.kind}`)}
                  </Text>
                  <Text className={c.optionDescription}>
                    {tr(
                      rule.decision === "allow"
                        ? "consent.allowed"
                        : "consent.blocked"
                    )}
                  </Text>
                  {rule.kind === "persistent-storage" &&
                    rule.decision === "allow" && (
                      <Text className={c.optionDescription}>
                        {tr("consent.persistentWarning")}
                      </Text>
                    )}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={tr("consent.forgetLabel", {
                    kind: tr(`consent.kind.${rule.kind}`),
                    origin,
                  })}
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  className={cn(
                    c.consentButton,
                    actionState({ disabled: busy })
                  )}
                  onPress={() =>
                    void perform(
                      () => onRevoke(origin, rule.kind),
                      tr("consent.forgot")
                    )
                  }
                >
                  <Text className={c.optionTitle}>{tr("consent.forget")}</Text>
                </Pressable>
              </View>
            ))}
          </View>
        ))}
        <ConsentAction
          title={tr("consent.forgetAll")}
          description={tr("consent.forgetAllDetail")}
          disabled={busy}
          onPress={() => void perform(onClearAll, tr("consent.cleared"))}
        />
        <Text className={c.optionDescription}>
          {tr("consent.resetWarning")}
        </Text>
        <ConsentFeedback feedback={feedback} target="saved" />
      </View>

      <View>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: details }}
          className={c.consentRow}
          onPress={() => setDetails(!details)}
        >
          <Text className={cn(c.optionTitle, c.consentCopy)}>
            {tr("consent.details")}
          </Text>
          <ChromeIcon name={details ? "chevronUp" : "chevronDown"} size={18} />
        </Pressable>
        {details && (
          <View className={c.consentDetails}>
            <Text className={c.optionDescription}>
              {tr("consent.scopeHelp")}
            </Text>
            <Text className={c.optionDescription}>
              {tr("consent.purpose.persistent-storage")}
            </Text>
            <Text className={c.optionDescription}>
              {tr("consent.androidHelp")}
            </Text>
            <Text className={c.optionDescription}>
              {tr("consent.otherOptional")}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

function ConsentFeedback({
  feedback,
  target,
}: {
  feedback: ActionFeedback | null;
  target: string;
}) {
  if (!feedback || feedback.target !== target) return null;
  return (
    <Text
      accessibilityLiveRegion="polite"
      accessibilityRole={feedback.error ? "alert" : undefined}
      className={cn(
        feedback.error ? c.consentError : c.consentNotice,
        "w-full"
      )}
    >
      {feedback.message}
    </Text>
  );
}

function ConsentAction({
  title,
  description,
  disabled = false,
  onPress,
}: {
  title: string;
  description?: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={cn(c.consentRow, actionState({ disabled }))}
    >
      <View className={c.consentCopy}>
        <Text className={c.optionTitle}>{title}</Text>
        {description && (
          <Text className={c.optionDescription}>{description}</Text>
        )}
      </View>
      <ChromeIcon name="chevronRight" size={18} />
    </Pressable>
  );
}
