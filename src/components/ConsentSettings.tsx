import React, { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useThemedStyles } from "../chrome/appStyles";
import { ChromeIcon } from "../chrome/ChromeIcon";
import { useI18n } from "../i18nContext";
import {
  ANDROID_PERMISSION_KINDS,
  type AndroidPermissionKind,
  type ConsentRuntime,
} from "../consent";
import { useConsentPermissions } from "../hooks/useConsentPermissions";
import { platform } from "../platform";
import type { SitePermission, PermissionDecision } from "../permissions";
import type { PermissionKind } from "../uiPreferences";

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

/** Preparing Android access never grants a website access to the device. */
export function ConsentSettings({
  rules,
  onRevoke,
  onClearAll,
  siteUrl,
  privateSite,
  onAutoplayChange,
}: Props) {
  const s = useThemedStyles();
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
    perform(async () => {
      const request = runtime.requestAndroidPermission;
      if (!request) return;
      try {
        const allowed = await request.call(runtime, kind);
        if (!allowed) return tr("consent.deniedHelp");
      } finally {
        await android.refresh();
      }
    }, undefined, kind);

  return (
    <View style={s.consentPage}>
      <View style={s.consentIntro}>
        <ChromeIcon name="check" size={20} />
        <View style={s.consentCopy}>
          <Text style={s.optionTitle}>{tr("consent.basic")}</Text>
          <Text style={s.optionDescription}>{tr("consent.basicHelp")}</Text>
        </View>
      </View>

      <View>
        <Text accessibilityRole="header" style={[s.settingsSection, { marginTop: 0 }]}>
          {tr("consent.deviceTitle")}
        </Text>
        <Text style={s.optionDescription}>{tr("consent.deviceHelp")}</Text>
        <View style={s.consentGroup}>
          {ANDROID_PERMISSION_KINDS.map((kind) => {
            const status = android.status[kind];
            const granted = status === "allowed" || status === "approximate";
            const label = tr(`consent.kind.${kind}`);
            return (
              <View key={kind} style={s.consentRow}>
                <View style={s.consentCopy}>
                  <Text style={s.optionTitle}>{label}</Text>
                  <Text style={s.optionDescription}>
                    {tr(`consent.purpose.${kind}`)}
                  </Text>
                  <Text style={s.consentStatus}>
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
                    style={({ pressed }) => [
                      s.consentButton,
                      pressed && s.pressed,
                      (busy ||
                        android.loading ||
                        !runtime.requestAndroidPermission) &&
                        s.disabled,
                    ]}
                    onPress={() => void prepareAccess(kind)}
                  >
                    <Text style={s.optionTitle}>{tr("consent.grant")}</Text>
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
            if (open) void perform(() => open.call(runtime), undefined, "android");
          }}
        />
        {!runtime.openAndroidPermissionSettings && (
          <Text style={s.optionDescription}>{tr("consent.androidManual")}</Text>
        )}
        {android.error && (
          <>
            <Text accessibilityRole="alert" style={s.optionDescription}>
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

      <View style={s.consentIntro}>
        <ChromeIcon name="play" size={20} />
        <View style={s.consentCopy}>
          <Text style={s.optionTitle}>{tr("consent.defaults")}</Text>
          <Text style={s.optionDescription}>{tr("consent.defaultsHelp")}</Text>
        </View>
      </View>
      {currentOrigin && onAutoplayChange && (
        <View>
          <Text style={s.optionTitle}>{tr("consent.siteAutoplay")}</Text>
          <Text selectable style={s.optionDescription}>
            {currentOrigin}
          </Text>
          <View style={s.consentChoices}>
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
                style={({ pressed }) => [
                  s.consentChoice,
                  autoplay === choice && s.consentChoiceSelected,
                  pressed && s.pressed,
                  busy && s.disabled,
                ]}
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
                <Text style={s.optionTitle}>
                  {tr(`consent.autoplay.${choice}`)}
                </Text>
              </Pressable>
            ))}
          </View>
          <ConsentFeedback feedback={feedback} target="autoplay" />
        </View>
      )}

      <View>
        <Text accessibilityRole="header" style={[s.settingsSection, { marginTop: 0 }]}>
          {tr("consent.saved")}
        </Text>
        <Text style={s.optionDescription}>
          {rules.length
            ? tr("consent.savedCount", { count: rules.length })
            : tr("consent.empty")}
        </Text>
        {[...groups].map(([origin, siteRules]) => (
          <View key={origin} style={s.consentGroup}>
            <Text selectable style={s.consentOrigin}>
              {origin}
            </Text>
            {siteRules.map((rule) => (
              <View key={rule.kind} style={s.consentRow}>
                <View style={s.consentCopy}>
                  <Text style={s.optionTitle}>
                    {tr(`consent.kind.${rule.kind}`)}
                  </Text>
                  <Text style={s.optionDescription}>
                    {tr(
                      rule.decision === "allow"
                        ? "consent.allowed"
                        : "consent.blocked"
                    )}
                  </Text>
                  {rule.kind === "persistent-storage" &&
                    rule.decision === "allow" && (
                      <Text style={s.optionDescription}>
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
                  style={({ pressed }) => [
                    s.consentButton,
                    pressed && s.pressed,
                    busy && s.disabled,
                  ]}
                  onPress={() =>
                    void perform(
                      () => onRevoke(origin, rule.kind),
                      tr("consent.forgot")
                    )
                  }
                >
                  <Text style={s.optionTitle}>{tr("consent.forget")}</Text>
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
        <Text style={s.optionDescription}>{tr("consent.resetWarning")}</Text>
        <ConsentFeedback feedback={feedback} target="saved" />
      </View>

      <View>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: details }}
          style={s.consentRow}
          onPress={() => setDetails(!details)}
        >
          <Text style={[s.optionTitle, s.consentCopy]}>
            {tr("consent.details")}
          </Text>
          <ChromeIcon name={details ? "chevronUp" : "chevronDown"} size={18} />
        </Pressable>
        {details && (
          <View style={s.consentDetails}>
            <Text style={s.optionDescription}>{tr("consent.scopeHelp")}</Text>
            <Text style={s.optionDescription}>
              {tr("consent.purpose.persistent-storage")}
            </Text>
            <Text style={s.optionDescription}>{tr("consent.androidHelp")}</Text>
            <Text style={s.optionDescription}>
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
  const s = useThemedStyles();
  if (!feedback || feedback.target !== target) return null;
  return (
    <Text
      accessibilityLiveRegion="polite"
      accessibilityRole={feedback.error ? "alert" : undefined}
      style={[feedback.error ? s.consentError : s.consentNotice, { width: "100%" }]}
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
  const s = useThemedStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.consentRow,
        pressed && s.pressed,
        disabled && s.disabled,
      ]}
    >
      <View style={s.consentCopy}>
        <Text style={s.optionTitle}>{title}</Text>
        {description && <Text style={s.optionDescription}>{description}</Text>}
      </View>
      <ChromeIcon name="chevronRight" size={18} />
    </Pressable>
  );
}
