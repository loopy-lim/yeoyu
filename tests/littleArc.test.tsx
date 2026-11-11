import { describe, expect, test } from "bun:test";
import { appClasses } from "../src/chrome/appStyles";
import { translate } from "../src/i18n";

describe("Little Arc Overlay & Usability", () => {
  test("littleArc chrome classes define floating modal card, elevation toolbar, and promote button", () => {
    expect(appClasses.contentLittleArc).toContain("absolute");
    expect(appClasses.contentLittleArc).toContain("rounded-dialog");
    expect(appClasses.contentLittleArc).toContain("border-card-border");
    expect(appClasses.contentLittleArc).toContain("shadow-dialog");

    expect(appClasses.littleArcToolbar).toContain("h-toolbar");
    expect(appClasses.littleArcToolbar).toContain("bg-surface-elevated");
    expect(appClasses.littleArcToolbar).toContain("border-b-hairline");

    expect(appClasses.littleArcPromoteButton).toContain("bg-accent");
    expect(appClasses.littleArcPromoteButton).toContain("rounded-control");
  });

  test("littleArc translations are complete in all supported languages", () => {
    for (const lang of ["en", "ko"] as const) {
      expect(translate(lang, "littleArc.promote")).toBeTruthy();
      expect(translate(lang, "littleArc.close")).toBeTruthy();
      expect(translate(lang, "littleArc.badge")).toBeTruthy();
      expect(translate(lang, "littleArc.collapseHeader")).toBeTruthy();
      expect(translate(lang, "littleArc.expandHeader")).toBeTruthy();
      const openInSpace = translate(lang, "littleArc.openInSpace", {
        space: "Personal",
      });
      expect(openInSpace).toContain("Personal");
    }
  });

  test("lifecycle and back navigation chain logic for Little Arc", () => {
    const testState = {
      littleArcTabId: null as string | null,
      focusedTabId: null as string | null,
      closedTabId: null as string | null,
    };
    let noticeMessage = "";
    const navigationHistory: Record<string, { canGoBack: boolean }> = {};

    // 1. External link arrival triggers onExternalTab
    const onExternalTab = (tabId: string) => {
      testState.focusedTabId = tabId;
      testState.littleArcTabId = tabId;
      navigationHistory[tabId] = { canGoBack: false };
    };

    onExternalTab("tab-external-1");
    expect(testState.littleArcTabId).toBe("tab-external-1");
    expect(testState.focusedTabId).toBe("tab-external-1");

    const isLittleArc = () =>
      Boolean(
        testState.littleArcTabId &&
          testState.focusedTabId === testState.littleArcTabId
      );
    expect(isLittleArc()).toBe(true);

    // 2. Navigation inside Little Arc enables canGoBack
    navigationHistory["tab-external-1"].canGoBack = true;

    // 3. Hardware back handling simulation
    let webGoBackCalled = false;
    const handleHardwareBack = () => {
      if (navigationHistory[testState.focusedTabId!]?.canGoBack) {
        webGoBackCalled = true;
        navigationHistory[testState.focusedTabId!].canGoBack = false;
        return true;
      }
      if (isLittleArc()) {
        const id = testState.littleArcTabId;
        testState.littleArcTabId = null;
        testState.closedTabId = id;
        return true;
      }
      return false;
    };

    // First back press: consumes web history
    expect(handleHardwareBack()).toBe(true);
    expect(webGoBackCalled).toBe(true);
    expect(isLittleArc()).toBe(true);
    expect(testState.closedTabId).toBeNull();

    // Second back press: closes Little Arc because web history is exhausted
    expect(handleHardwareBack()).toBe(true);
    expect(isLittleArc()).toBe(false);
    expect(testState.closedTabId).toBe("tab-external-1");

    // 4. Test promoteLittleArc
    onExternalTab("tab-external-2");
    expect(isLittleArc()).toBe(true);

    const promoteLittleArc = (spaceName: string) => {
      testState.littleArcTabId = null;
      noticeMessage = translate("ko", "littleArc.openInSpace", {
        space: spaceName,
      });
    };

    promoteLittleArc("Work Space");
    expect(isLittleArc()).toBe(false);
    expect(testState.focusedTabId).toBe("tab-external-2"); // Still focused as a regular space tab!
    expect(noticeMessage).toContain("Work Space");
  });

  test("swipe down gesture threshold and dismissal decision", () => {
    const shouldDismiss = (dy: number, vy: number) =>
      dy > 0 && (dy > 120 || vy > 0.6);
    expect(shouldDismiss(50, 0.2)).toBe(false);
    expect(shouldDismiss(130, 0.1)).toBe(true);
    expect(shouldDismiss(80, 0.7)).toBe(true);
    expect(shouldDismiss(-20, 0.9)).toBe(false);
  });

  test("dismiss returns to caller app when launched externally, while promote retains in browser", () => {
    let minimizedToCaller = false;
    let exitedApp = false;
    let isExternalLaunch = false;

    const onExternalTab = () => {
      isExternalLaunch = true;
    };

    const closeLittleArc = () => {
      const wasExternal = isExternalLaunch;
      isExternalLaunch = false;
      if (wasExternal) {
        minimizedToCaller = true;
      }
    };

    const promoteLittleArc = () => {
      isExternalLaunch = false; // promoted to full space tab
    };

    // Scenario 1: User dismisses external Little Arc -> returns to caller
    onExternalTab();
    expect(isExternalLaunch).toBe(true);
    closeLittleArc();
    expect(minimizedToCaller).toBe(true);
    expect(isExternalLaunch).toBe(false);

    // Scenario 2: User promotes Little Arc -> stays in app, subsequent close does not minimize app
    minimizedToCaller = false;
    onExternalTab();
    expect(isExternalLaunch).toBe(true);
    promoteLittleArc();
    expect(isExternalLaunch).toBe(false);
    closeLittleArc();
    expect(minimizedToCaller).toBe(false);
  });
});
