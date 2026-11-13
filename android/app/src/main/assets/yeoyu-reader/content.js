/* Evaluates page readerability with Mozilla Readability and toggles an in-page
 * Reader View synchronized with yeoyu's active theme and textScale. */
(() => {
  "use strict";
  if (window !== window.top) return;

  const NATIVE_APP = "yeoyu_reader";
  const READER_ROOT_ID = "yeoyu-reader-root";
  const RETRY_MS = [250, 1000, 4000];
  const BLOCKED_HOSTS = [
    "amazon.com",
    "github.com",
    "mail.google.com",
    "pinterest.com",
    "reddit.com",
    "twitter.com",
    "x.com",
    "youtube.com",
    "app.slack.com",
  ];
  const BLOCKED_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "IFRAME",
    "FRAME",
    "FRAMESET",
    "OBJECT",
    "EMBED",
    "APPLET",
    "BASE",
    "META",
    "LINK",
    "FORM",
    "INPUT",
    "TEXTAREA",
    "SELECT",
    "BUTTON",
  ]);
  const URL_ATTRS = new Set(["href", "src", "xlink:href", "poster", "action"]);

  let port = null;
  let pageAlive = true;
  let documentToken = "";
  let attempts = 0;
  let retryTimer = null;
  let readerActive = false;
  let readerable = false;
  let lastReportedSignature = "";
  let lastHref = window.location.href;
  let savedScrollY = 0;
  let disabledSheets = [];
  let observer = null;
  let observerStopTimer = null;
  let debounceTimer = null;

  let currentStyle = {
    bg: "#f7f6f7",
    fg: "#3d3642",
    muted: "#564e5c",
    accent: "#7d697f",
    border: "#e2dee6",
    sunken: "#eeebf0",
    fontSizePx: 18,
    readTimeFormat: "{n} min read",
  };

  function makeToken() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function beginDocumentEpoch() {
    documentToken = makeToken();
    lastReportedSignature = "";
  }

  function shouldCheckUri() {
    const loc = window.location;
    if (loc.protocol !== "http:" && loc.protocol !== "https:") return false;
    if (document.mozSyntheticDocument) return false;
    if (document.contentType === "application/pdf") return false;
    const host = (loc.hostname || "").toLowerCase();
    for (const blocked of BLOCKED_HOSTS) {
      if (host === blocked || host.endsWith("." + blocked)) {
        if (
          host === "github.com" &&
          loc.pathname !== "/" &&
          !loc.pathname.includes("/projects") &&
          !loc.pathname.includes("/issues")
        ) {
          return true;
        }
        return false;
      }
    }
    if (loc.pathname === "/" && !loc.search) return false;
    return true;
  }

  function isVisibleNode(node) {
    return node.clientHeight > 0 && node.clientWidth > 0;
  }

  function computeReaderable() {
    if (readerActive) return true;
    if (!shouldCheckUri()) return false;
    if (typeof isProbablyReaderable !== "function") return false;
    try {
      return Boolean(isProbablyReaderable(document, isVisibleNode));
    } catch (_) {
      return false;
    }
  }

  function postState(force = false, extra = undefined) {
    if (!port || !pageAlive) return;
    if (!documentToken) beginDocumentEpoch();
    const state = {
      type: "reader-state",
      documentToken,
      url: window.location.href,
      readerable,
      active: readerActive,
      ...(extra || {}),
    };
    const sig = JSON.stringify([state.documentToken, state.url, state.readerable, state.active, Boolean(extra)]);
    if (!force && sig === lastReportedSignature) return;
    lastReportedSignature = sig;
    try {
      port.postMessage(state);
    } catch (_) {
      disconnected(port);
    }
  }

  function refreshReaderable(force = false) {
    if (!pageAlive) return;
    if (window.location.href !== lastHref) {
      lastHref = window.location.href;
      if (readerActive) exitReaderMode(false);
    }
    const next = computeReaderable();
    const changed = next !== readerable;
    readerable = next;
    if (changed || force) postState(force);
    if (readerable && observer) stopObserver();
  }

  function stopObserver() {
    if (observer) {
      try { observer.disconnect(); } catch (_) {}
      observer = null;
    }
    if (observerStopTimer !== null) {
      clearTimeout(observerStopTimer);
      observerStopTimer = null;
    }
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }

  function startHydrationObserver() {
    stopObserver();
    if (!pageAlive || !shouldCheckUri() || readerable || !document.body) return;
    try {
      observer = new MutationObserver(() => {
        if (debounceTimer !== null) return;
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          refreshReaderable(false);
        }, 400);
      });
      observer.observe(document.body, { childList: true, subtree: true });
      observerStopTimer = setTimeout(() => {
        stopObserver();
        refreshReaderable(false);
      }, 4000);
    } catch (_) {
      stopObserver();
    }
  }

  function formatReadTime(mins) {
    return currentStyle.readTimeFormat.replace("{n}", String(mins));
  }

  function applyStyleVariables(style) {
    if (!style || typeof style !== "object") return;
    currentStyle = {
      bg: typeof style.bg === "string" ? style.bg : currentStyle.bg,
      fg: typeof style.fg === "string" ? style.fg : currentStyle.fg,
      muted: typeof style.muted === "string" ? style.muted : currentStyle.muted,
      accent: typeof style.accent === "string" ? style.accent : currentStyle.accent,
      border: typeof style.border === "string" ? style.border : currentStyle.border,
      sunken: typeof style.sunken === "string" ? style.sunken : currentStyle.sunken,
      fontSizePx:
        typeof style.fontSizePx === "number" && Number.isFinite(style.fontSizePx)
          ? Math.max(12, Math.min(36, Math.round(style.fontSizePx)))
          : currentStyle.fontSizePx,
      readTimeFormat:
        typeof style.readTimeFormat === "string" && style.readTimeFormat.includes("{n}")
          ? style.readTimeFormat
          : currentStyle.readTimeFormat,
    };
    if (!readerActive) return;
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty("--yr-bg", currentStyle.bg);
    rootStyle.setProperty("--yr-fg", currentStyle.fg);
    rootStyle.setProperty("--yr-muted", currentStyle.muted);
    rootStyle.setProperty("--yr-accent", currentStyle.accent);
    rootStyle.setProperty("--yr-border", currentStyle.border);
    rootStyle.setProperty("--yr-sunken", currentStyle.sunken);
    rootStyle.setProperty("--yr-font-size", `${currentStyle.fontSizePx}px`);
    const metaEl = document.querySelector(`#${READER_ROOT_ID} .yr-meta`);
    if (metaEl && metaEl.dataset.mins) {
      metaEl.textContent = formatReadTime(metaEl.dataset.mins);
    }
  }

  function clearStyleVariables() {
    const rootStyle = document.documentElement.style;
    rootStyle.removeProperty("--yr-bg");
    rootStyle.removeProperty("--yr-fg");
    rootStyle.removeProperty("--yr-muted");
    rootStyle.removeProperty("--yr-accent");
    rootStyle.removeProperty("--yr-border");
    rootStyle.removeProperty("--yr-sunken");
    rootStyle.removeProperty("--yr-font-size");
  }

  function isSafeUrl(raw, attrName) {
    const trimmed = (raw || "").trim();
    if (!trimmed) return false;
    if (attrName === "href" && trimmed.startsWith("#")) return true;
    try {
      const parsed = new URL(trimmed, document.baseURI);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") return true;
      if (
        attrName !== "href" &&
        attrName !== "action" &&
        /^data:image\/(?:png|jpeg|jpg|gif|webp|avif);base64,/i.test(trimmed)
      ) {
        return true;
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  function sanitizeFragment(html) {
    const parser = new DOMParser();
    const parsed = parser.parseFromString(String(html || ""), "text/html");
    const walk = (parent) => {
      const children = Array.from(parent.childNodes);
      for (const node of children) {
        if (node.nodeType === Node.COMMENT_NODE) {
          parent.removeChild(node);
          continue;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (BLOCKED_TAGS.has(node.tagName)) {
          parent.removeChild(node);
          continue;
        }
        const attrs = Array.from(node.attributes);
        for (const attr of attrs) {
          const name = attr.name.toLowerCase();
          if (name.startsWith("on") || name === "style" || name === "srcdoc") {
            node.removeAttribute(attr.name);
            continue;
          }
          if (name === "srcset") {
            const parts = attr.value
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean);
            const allSafe = parts.every((part) => isSafeUrl(part.split(/\s+/)[0], "src"));
            if (!allSafe) node.removeAttribute(attr.name);
            continue;
          }
          if (URL_ATTRS.has(name) && !isSafeUrl(attr.value, name)) {
            node.removeAttribute(attr.name);
          }
        }
        walk(node);
      }
    };
    walk(parsed.body);
    const fragment = document.createDocumentFragment();
    while (parsed.body.firstChild) {
      fragment.appendChild(document.adoptNode(parsed.body.firstChild));
    }
    return fragment;
  }

  function estimateMinutes(textContent) {
    const text = (textContent || "").trim();
    if (!text) return 1;
    const cjkCount = (text.match(/[\u3131-\uD79D\u4E00-\u9FFF\u3040-\u30FF]/g) || []).length;
    if (cjkCount > text.length * 0.25) {
      return Math.max(1, Math.round(text.length / 500));
    }
    const words = text.split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(words / 220));
  }

  function enterReaderMode(style, requestId) {
    if (style) applyStyleVariables(style);
    if (readerActive) {
      applyStyleVariables(currentStyle);
      postState(true, { requestId, ok: true });
      return;
    }
    if (!shouldCheckUri() || typeof Readability !== "function" || !document.body) {
      postState(true, { requestId, ok: false, error: "unavailable" });
      return;
    }
    let article = null;
    try {
      const clone = document.cloneNode(true);
      article = new Readability(clone).parse();
    } catch (_) {
      article = null;
    }
    if (!article || !article.content) {
      readerable = false;
      postState(true, { requestId, ok: false, error: "unreadable" });
      return;
    }

    savedScrollY = window.scrollY;
    disabledSheets = [];
    for (const sheet of Array.from(document.styleSheets || [])) {
      try {
        if (sheet.href && sheet.href.startsWith("moz-extension://")) continue;
        disabledSheets.push({ sheet, prev: sheet.disabled });
        sheet.disabled = true;
      } catch (_) {}
    }

    const existing = document.getElementById(READER_ROOT_ID);
    if (existing) existing.remove();

    const root = document.createElement("main");
    root.id = READER_ROOT_ID;
    root.setAttribute("role", "main");

    const container = document.createElement("div");
    container.className = "yr-container";
    if (article.dir === "rtl" || article.dir === "ltr") container.dir = article.dir;
    if (article.lang) container.lang = article.lang;

    const header = document.createElement("header");
    header.className = "yr-header";

    const domainText =
      (article.siteName && article.siteName.trim()) ||
      window.location.hostname.replace(/^www\./, "");
    if (domainText) {
      const domainEl = document.createElement("div");
      domainEl.className = "yr-domain";
      domainEl.textContent = domainText;
      header.appendChild(domainEl);
    }

    const titleEl = document.createElement("h1");
    titleEl.className = "yr-title";
    titleEl.textContent = (article.title || document.title || "").trim();
    header.appendChild(titleEl);

    if (article.byline && article.byline.trim()) {
      const bylineEl = document.createElement("p");
      bylineEl.className = "yr-byline";
      bylineEl.textContent = article.byline.trim();
      header.appendChild(bylineEl);
    }

    const mins = estimateMinutes(article.textContent);
    const metaEl = document.createElement("div");
    metaEl.className = "yr-meta";
    metaEl.dataset.mins = String(mins);
    metaEl.textContent = formatReadTime(mins);
    header.appendChild(metaEl);

    const divider = document.createElement("hr");
    divider.className = "yr-divider";

    const contentEl = document.createElement("article");
    contentEl.className = "yr-content";
    contentEl.appendChild(sanitizeFragment(article.content));

    container.appendChild(header);
    container.appendChild(divider);
    container.appendChild(contentEl);
    root.appendChild(container);
    document.body.appendChild(root);

    readerActive = true;
    readerable = true;
    document.documentElement.dataset.yeoyuReader = "on";
    applyStyleVariables(currentStyle);
    window.scrollTo(0, 0);
    stopObserver();
    postState(true, { requestId, ok: true });
  }

  function exitReaderMode(notify = true, requestId = undefined) {
    const existing = document.getElementById(READER_ROOT_ID);
    if (existing) existing.remove();
    delete document.documentElement.dataset.yeoyuReader;
    clearStyleVariables();
    for (const item of disabledSheets) {
      try {
        item.sheet.disabled = item.prev;
      } catch (_) {}
    }
    disabledSheets = [];
    const wasActive = readerActive;
    readerActive = false;
    if (wasActive && savedScrollY > 0) {
      try { window.scrollTo(0, savedScrollY); } catch (_) {}
    }
    savedScrollY = 0;
    readerable = computeReaderable();
    if (notify) {
      postState(true, requestId !== undefined ? { requestId, ok: true } : undefined);
    }
  }

  function receive(message) {
    if (!message || !pageAlive) return;
    if (message.type === "connected") {
      if (message.documentToken === documentToken) attempts = 0;
      if (message.style) applyStyleVariables(message.style);
      refreshReaderable(true);
    } else if (message.type === "check-readerable") {
      if (message.style) applyStyleVariables(message.style);
      refreshReaderable(true);
      startHydrationObserver();
    } else if (message.type === "set-reader-mode") {
      if (message.enabled) enterReaderMode(message.style, message.requestId);
      else exitReaderMode(true, message.requestId);
    } else if (message.type === "update-reader-style") {
      applyStyleVariables(message.style);
    }
  }

  function disconnected(oldPort) {
    if (port !== oldPort) return;
    port = null;
    if (pageAlive && retryTimer === null && attempts < RETRY_MS.length) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        connect();
      }, RETRY_MS[attempts++]);
    }
  }

  function connect() {
    if (!pageAlive || port) return;
    try {
      const next = browser.runtime.connectNative(NATIVE_APP);
      port = next;
      if (!documentToken) beginDocumentEpoch();
      next.onMessage.addListener((message) => {
        if (port === next) receive(message);
      });
      next.onDisconnect.addListener(() => disconnected(next));
      readerable = computeReaderable();
      postState(true);
    } catch (_) {
      disconnected(port);
    }
  }

  window.addEventListener("pagehide", (event) => {
    if (!event.isTrusted || !pageAlive) return;
    pageAlive = false;
    stopObserver();
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
    const old = port;
    port = null;
    try { old?.disconnect(); } catch (_) {}
  });

  window.addEventListener("pageshow", (event) => {
    if (event.isTrusted && event.persisted && !pageAlive) {
      beginDocumentEpoch();
      pageAlive = true;
      attempts = 0;
      connect();
      startHydrationObserver();
    }
  });

  window.addEventListener("load", () => refreshReaderable(false));
  window.addEventListener("popstate", () => refreshReaderable(true));
  window.addEventListener("hashchange", () => refreshReaderable(false));
  document.addEventListener("DOMContentLoaded", () => {
    refreshReaderable(false);
    startHydrationObserver();
  });

  connect();
  startHydrationObserver();
})();
