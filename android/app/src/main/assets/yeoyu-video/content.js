/* Observes the existing player. Never changes DOM, styles, playback, or media URLs. */
(() => {
  'use strict';
  if (window !== window.top) return;

  const HEARTBEAT_MS = 250;
  // Integer CSS sizing can differ from fractional clipping bounds by up to one CSS pixel.
  const CLIP_ROUNDING_TOLERANCE = 1 + 1e-6;
  const RETRY_MS = [250, 1000, 4000];
  const mediaEvents = ['play', 'playing', 'pause', 'ended', 'emptied', 'loadedmetadata'];
  let port = null, pageAlive = true, documentToken = '', sequence = 0;
  let videoTokens = new WeakMap(), videoSequence = 0, selected = null, watch = null;
  let raf = null, heartbeat = null, retry = null, attempts = 0, generation = 0;
  let lastSignature = '', anyPlaying = false;
  const observedDocuments = new Set();

  function token() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16)).join('-');
  }
  function videoToken(video) {
    if (!videoTokens.has(video)) videoTokens.set(video, `${documentToken}:${++videoSequence}`);
    return videoTokens.get(video);
  }
  function beginDocumentEpoch() {
    documentToken = token(); sequence = 0;
    videoTokens = new WeakMap(); videoSequence = 0;
  }
  function viewport(win) {
    const vv = win.visualViewport;
    return { width: win.innerWidth, height: win.innerHeight,
      visualWidth: vv ? vv.width : win.innerWidth, visualHeight: vv ? vv.height : win.innerHeight,
      offsetLeft: vv ? vv.offsetLeft : 0, offsetTop: vv ? vv.offsetTop : 0, scale: vv ? vv.scale : 1 };
  }
  function safeViewport(vp) {
    return Object.values(vp).every(Number.isFinite) && vp.width > 0 && vp.height > 0 &&
      vp.visualWidth > 0 && vp.visualHeight > 0 && Math.abs(vp.scale - 1) <= 0.001 &&
      Math.abs(vp.offsetLeft) <= 0.01 && Math.abs(vp.offsetTop) <= 0.01;
  }
  function rectOf(element) {
    const r = element.getBoundingClientRect();
    const rect = { x: r.left, y: r.top, width: r.width, height: r.height };
    if (!Object.values(rect).every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return null;
    return rect;
  }
  function contains(outer, inner, x = true, y = true, tolerance = 0) {
    return (!x || (inner.x >= outer.x - tolerance && inner.x + inner.width <= outer.x + outer.width + tolerance)) &&
      (!y || (inner.y >= outer.y - tolerance && inner.y + inner.height <= outer.y + outer.height + tolerance));
  }
  function intersect(outer, inner, x = true, y = true) {
    const left = x ? Math.max(outer.x, inner.x) : inner.x;
    const top = y ? Math.max(outer.y, inner.y) : inner.y;
    const right = x ? Math.min(outer.x + outer.width, inner.x + inner.width) : inner.x + inner.width;
    const bottom = y ? Math.min(outer.y + outer.height, inner.y + inner.height) : inner.y + inner.height;
    return right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : null;
  }
  function axisAligned(style) {
    if (style.transform && style.transform !== 'none') {
      const match = /^matrix\(([^)]+)\)$/.exec(style.transform);
      if (!match) return false;
      const m = match[1].split(',').map(Number);
      if (m.length !== 6 || !m.every(Number.isFinite) || m[0] <= 0 || m[3] <= 0 || m[1] !== 0 || m[2] !== 0) return false;
    }
    if (style.rotate && !['none', '0deg', '0rad', '0turn'].includes(style.rotate)) return false;
    if (style.scale && style.scale !== 'none' && !style.scale.split(/\s+/).every(v => Number(v) > 0)) return false;
    return !style.perspective || style.perspective === 'none';
  }
  function overflowBounds(element, win) {
    const doc = win.document, root = doc.documentElement;
    const css = win.getComputedStyle(element);
    const uncontained = style => !style.contain || style.contain === 'none';
    let propagated = element === root && uncontained(css);
    if (element === doc.body && root?.tagName === 'HTML' && element.parentElement === root) {
      const rootCss = win.getComputedStyle(root);
      propagated = rootCss.overflowX === 'visible' && rootCss.overflowY === 'visible' &&
        uncontained(rootCss) && uncontained(css);
    }
    // CSS overflow from the root (or eligible HTML body) clips at the viewport,
    // not that element's potentially empty box. Contained boxes remain conservative.
    return propagated ? { x: 0, y: 0, width: win.innerWidth, height: win.innerHeight } : contentRect(element, win);
  }
  function visibleRect(element, win, rect) {
    if (!element.isConnected || !safeViewport(viewport(win)) ||
      !contains({ x: 0, y: 0, width: win.innerWidth, height: win.innerHeight }, rect)) return null;
    let clipped = rect;
    for (let node = element; node; node = node.parentElement) {
      const css = win.getComputedStyle(node);
      if (css.display === 'none' || css.visibility !== 'visible' || Number(css.opacity) !== 1 ||
        css.contentVisibility === 'hidden' || !axisAligned(css) ||
        (css.clipPath && css.clipPath !== 'none') || (css.maskImage && css.maskImage !== 'none')) return null;
      if (node !== element) {
        const clipX = ['hidden', 'clip', 'scroll', 'auto'].includes(css.overflowX);
        const clipY = ['hidden', 'clip', 'scroll', 'auto'].includes(css.overflowY);
        if (clipX || clipY) {
          const bounds = overflowBounds(node, win);
          // Compare every ancestor with the original box so rounding allowances cannot accumulate.
          if (!bounds || !contains(bounds, rect, clipX, clipY, CLIP_ROUNDING_TOLERANCE)) return null;
          clipped = intersect(bounds, clipped, clipX, clipY);
          if (!clipped) return null;
        }
      }
    }
    return clipped;
  }
  function contentRect(element, win) {
    const rect = rectOf(element);
    if (!rect || element.offsetWidth <= 0 || element.offsetHeight <= 0) return null;
    const css = win.getComputedStyle(element);
    const sx = rect.width / element.offsetWidth, sy = rect.height / element.offsetHeight;
    const size = name => Number.parseFloat(css[name]) || 0;
    const left = size('borderLeftWidth') + size('paddingLeft');
    const right = size('borderRightWidth') + size('paddingRight');
    const top = size('borderTopWidth') + size('paddingTop');
    const bottom = size('borderBottomWidth') + size('paddingBottom');
    const inner = { x: rect.x + left * sx, y: rect.y + top * sy,
      width: rect.width - (left + right) * sx, height: rect.height - (top + bottom) * sy };
    return inner.width > 0 && inner.height > 0 ? inner : null;
  }
  function picture(candidate) {
    const { video, win, frames } = candidate;
    if (video.ownerDocument !== win.document || !video.isConnected || video.ended || video.readyState < 2 ||
      !Number.isFinite(video.videoWidth) || !Number.isFinite(video.videoHeight) ||
      video.videoWidth <= 0 || video.videoHeight <= 0) return null;
    let rect = contentRect(video, win);
    const visibleBox = rect && visibleRect(video, win, rect);
    if (!visibleBox) return null;
    const css = win.getComputedStyle(video);
    // Only this straightforward case trims letterboxing; other object fits keep the video box.
    if (css.objectFit === 'contain' && ['50% 50%', 'center center', 'center'].includes(css.objectPosition)) {
      const box = rectOf(video);
      const sx = box.width / video.offsetWidth, sy = box.height / video.offsetHeight;
      const fit = Math.min(rect.width / sx / video.videoWidth, rect.height / sy / video.videoHeight);
      const width = video.videoWidth * fit * sx, height = video.videoHeight * fit * sy;
      rect = { x: rect.x + (rect.width - width) / 2, y: rect.y + (rect.height - height) / 2, width, height };
    }
    // Object-fit uses the original box; intersect only the resulting picture.
    let original = rect;
    rect = intersect(visibleBox, rect);
    if (!rect) return null;
    for (let i = frames.length - 1; i >= 0; i--) {
      const { frame, parent, child } = frames[i];
      if (frame.contentWindow !== child || frame.ownerDocument !== parent.document || !safeViewport(viewport(child))) return null;
      const frameRect = contentRect(frame, parent);
      const visibleFrame = frameRect && visibleRect(frame, parent, frameRect);
      if (!visibleFrame ||
        Math.abs(frame.clientWidth - child.innerWidth) > 1 || Math.abs(frame.clientHeight - child.innerHeight) > 1) return null;
      const style = parent.getComputedStyle(frame);
      if (['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom'].some(key => Number.parseFloat(style[key]) > 0)) return null;
      const sx = frameRect.width / child.innerWidth, sy = frameRect.height / child.innerHeight;
      rect = { x: frameRect.x + rect.x * sx, y: frameRect.y + rect.y * sy, width: rect.width * sx, height: rect.height * sy };
      original = { x: frameRect.x + original.x * sx, y: frameRect.y + original.y * sy,
        width: original.width * sx, height: original.height * sy };
      if (!contains(frameRect, rect)) return null;
      rect = intersect(visibleFrame, rect);
      if (!rect) return null;
    }
    // Frame scaling must not amplify local rounding beyond one top-level CSS pixel per edge.
    return contains(rect, original, true, true, CLIP_ROUNDING_TOLERANCE) ? rect : null;
  }
  function forgetDocument(doc) {
    observedDocuments.delete(doc);
    try {
      mediaEvents.forEach(type => doc.removeEventListener(type, changed, true));
      doc.removeEventListener('scroll', changed, true);
      doc.removeEventListener('load', frameLoaded, true);
    } catch (_) { /* Removed or navigated iframe wrappers may already be dead. */ }
  }
  function refreshDocuments(documents) {
    for (const doc of observedDocuments) if (!documents.has(doc)) forgetDocument(doc);
    for (const doc of documents) if (!observedDocuments.has(doc)) {
      try {
        mediaEvents.forEach(type => doc.addEventListener(type, changed, true));
        doc.addEventListener('scroll', changed, true);
        doc.addEventListener('load', frameLoaded, true); observedDocuments.add(doc);
      } catch (_) { forgetDocument(doc); }
    }
  }
  function discover() {
    const candidates = [], documents = new Set();
    anyPlaying = false;
    function visit(win, frames) {
      if (frames.length > 8) return;
      try {
        const doc = win.document;
        documents.add(doc);
        for (const node of doc.querySelectorAll('video, iframe, frame')) {
          if (node.tagName === 'VIDEO') {
            const playing = !node.paused && !node.ended;
            anyPlaying ||= playing;
            const candidate = { video: node, win, frames, token: videoToken(node) };
            const rect = picture(candidate);
            if (rect) candidates.push({ candidate, rect, playing });
          } else if (node.contentWindow) {
            const child = node.contentWindow;
            // Reading document is the same-origin check. No page message can supply geometry.
            try { if (child.document) visit(child, [...frames, { frame: node, parent: win, child }]); }
            catch (_) { /* Keep scanning siblings when this frame is restricted. */ }
          }
        }
      } catch (_) { /* Restricted, navigated or cross-origin frame: no usable geometry. */ }
    }
    visit(window, []); refreshDocuments(documents);
    candidates.sort((a, b) => Number(b.playing) - Number(a.playing) || b.rect.width * b.rect.height - a.rect.width * a.rect.height);
    selected = candidates[0]?.candidate || null;
    return selected;
  }
  function snapshot(reason) {
    const vp = viewport(window);
    const candidate = watch ? watch.candidate : discover();
    let rect = null;
    if (!reason && pageAlive && safeViewport(vp) && candidate) {
      try { rect = picture(candidate); } catch (_) { /* Document changed during measurement. */ }
    }
    return { type: 'video-region', observerRevision: '20260913-natural-ended-1', documentToken, videoToken: watch ? watch.videoToken : candidate?.token || null,
      viewport: vp, rect, playing: !!rect && !candidate.video.paused && !candidate.video.ended,
      videoWidth: rect ? candidate.video.videoWidth : 0, videoHeight: rect ? candidate.video.videoHeight : 0,
      ...(!rect ? { reason: reason || 'unavailable-region' } : {}), ...(watch ? { watchId: watch.watchId } : {}) };
  }
  // Explicit native diagnostics only: bounded top-level probe, never page strings or URLs.
  // This describes the largest playing box even when ordinary discovery rejected it.
  function diagnose() {
    const finite = value => Number.isFinite(value) ? value : null;
    const vp = viewport(window);
    const result = { gate: 'no-playing-video', inspectedVideos: 0, playingVideos: 0,
      viewport: Object.fromEntries(Object.entries(vp).map(([key, value]) => [key, finite(value)])) };
    const fail = gate => ({ ...result, gate });
    try {
      let video = null, largestArea = -1;
      for (const node of document.querySelectorAll('video')) {
        if (node.tagName !== 'VIDEO') continue;
        if (result.inspectedVideos === 8) break;
        result.inspectedVideos++;
        if (node.paused || node.ended) continue;
        result.playingVideos++;
        const box = rectOf(node), area = box ? box.width * box.height : 0;
        if (area > largestArea) { video = node; largestArea = area; result.rect = box; }
      }
      if (!video) return result;
      result.readyState = finite(video.readyState);
      result.videoWidth = finite(video.videoWidth); result.videoHeight = finite(video.videoHeight);
      if (!safeViewport(vp)) return fail('viewport');
      if (video.ownerDocument !== document || !video.isConnected) return fail('detached');
      if (video.readyState < 2) return fail('not-ready');
      if (!result.videoWidth || !result.videoHeight || video.videoWidth <= 0 || video.videoHeight <= 0) return fail('video-dimensions');
      const rect = contentRect(video, window);
      if (!rect) return fail('video-box');
      if (!contains({ x: 0, y: 0, width: vp.width, height: vp.height }, rect)) return fail('offscreen');
      let depth = 0;
      for (let node = video; node; node = node.parentElement, depth++) {
        if (depth === 24) return fail('ancestor-limit');
        result.ancestorDepth = depth;
        const css = window.getComputedStyle(node);
        if (css.display === 'none' || css.visibility !== 'visible' || css.contentVisibility === 'hidden') return fail('hidden');
        if (Number(css.opacity) !== 1) { result.opacity = finite(Number(css.opacity)); return fail('opacity'); }
        if (!axisAligned(css)) {
          const match = /^(matrix|matrix3d)\(([^)]+)\)$/.exec(css.transform);
          const values = match ? match[2].split(',').map(Number) : [];
          result.transformKind = match ? match[1] : css.transform === 'none' ? 'none' : 'other';
          result.transform = match && values.length === (match[1] === 'matrix' ? 6 : 16) && values.every(Number.isFinite) ? values : null;
          return fail('transform');
        }
        if (css.clipPath && css.clipPath !== 'none') return fail('clip-path');
        if (css.maskImage && css.maskImage !== 'none') return fail('mask');
        if (node !== video) {
          const clipX = ['hidden', 'clip', 'scroll', 'auto'].includes(css.overflowX);
          const clipY = ['hidden', 'clip', 'scroll', 'auto'].includes(css.overflowY);
          if (clipX || clipY) {
            const bounds = overflowBounds(node, window);
            if (!bounds || !contains(bounds, rect, clipX, clipY, CLIP_ROUNDING_TOLERANCE)) {
              result.clipBounds = bounds; result.clipX = clipX; result.clipY = clipY;
              const box = node.getBoundingClientRect();
              result.clipElement = {
                role: node === document.documentElement ? 'root' : node === document.body ? 'body' : 'element',
                display: ['block', 'inline', 'inline-block', 'contents', 'flex', 'grid'].includes(css.display) ? css.display : 'other',
                box: { x: finite(box.left), y: finite(box.top), width: finite(box.width), height: finite(box.height) },
                offsetWidth: finite(node.offsetWidth), offsetHeight: finite(node.offsetHeight),
                clientWidth: finite(node.clientWidth), clientHeight: finite(node.clientHeight),
              };
              return fail('clipped');
            }
          }
        }
      }
      return fail('accepted');
    } catch (_) { return fail('measurement-error'); }
  }
  function publish(force, requestId, reason, diagnostics = false) {
    if (!port || (!pageAlive && !reason)) return;
    const message = snapshot(reason);
    const signature = JSON.stringify(message);
    if (force || signature !== lastSignature) {
      lastSignature = signature;
      try { port.postMessage({ ...message, sequence: ++sequence, ...(requestId !== undefined ? { requestId } : {}),
        ...(diagnostics ? { diagnostic: diagnose() } : {}) }); }
      catch (_) { disconnected(port); return; }
    }
    if (pageAlive && (watch || anyPlaying)) {
      if (heartbeat === null) heartbeat = setInterval(() => publish(true), HEARTBEAT_MS);
    } else if (heartbeat !== null) { clearInterval(heartbeat); heartbeat = null; }
  }
  function stopWork() {
    generation++;
    if (raf !== null) cancelAnimationFrame(raf);
    if (heartbeat !== null) clearInterval(heartbeat);
    raf = heartbeat = null; watch = null;
  }
  function changed() { if (pageAlive && port) publish(true); }
  function frameLoaded(event) {
    if (event.target && ['IFRAME', 'FRAME'].includes(event.target.tagName)) changed();
  }
  function animate(epoch) {
    if (epoch !== generation || !watch || !port || !pageAlive) return;
    publish(false);
    if (epoch === generation && watch && port && pageAlive) raf = requestAnimationFrame(() => animate(epoch));
  }
  function receive(message) {
    if (!message || !pageAlive) return;
    if (message.type === 'connected') {
      // Native has accepted this document; rejected reconnects keep their bounded backoff.
      if (message.documentToken === documentToken) attempts = 0;
    } else if (message.type === 'measure') publish(true, message.requestId, undefined, message.diagnostics === true);
    else if (message.type === 'watch') {
      if (message.enabled === false) {
        if (!watch || message.watchId !== watch.watchId) return;
        stopWork(); lastSignature = ''; publish(true);
      } else if (message.enabled === true && typeof message.videoToken === 'string' &&
        (typeof message.watchId === 'string' || typeof message.watchId === 'number')) {
        const candidate = selected?.token === message.videoToken ? selected : null;
        stopWork(); watch = { candidate, videoToken: message.videoToken, watchId: message.watchId };
        lastSignature = ''; publish(true);
        const epoch = generation; raf = requestAnimationFrame(() => animate(epoch));
      }
    }
  }
  function disconnected(oldPort) {
    if (port !== oldPort) return;
    port = null; stopWork(); refreshDocuments(new Set());
    if (pageAlive && retry === null && attempts < RETRY_MS.length) {
      retry = setTimeout(() => { retry = null; connect(); }, RETRY_MS[attempts++]);
    }
  }
  function connect() {
    if (!pageAlive || port) return;
    try {
      const next = browser.runtime.connectNative('yeoyu_video');
      port = next;
      // A transport reconnect must not revive a document retired by native navigation.
      if (!documentToken) beginDocumentEpoch();
      selected = null; lastSignature = '';
      next.onMessage.addListener(message => {
        const probe = message?.type === 'measure' && message.diagnostics === true;
        const report = extra => {
          try { next.postMessage({ type: 'observer-probe', documentToken, current: port === next, alive: pageAlive, ...extra }); }
          catch (_) { /* Diagnostics cannot keep a broken transport alive. */ }
        };
        if (probe) report({ phase: 'received' });
        try { if (port === next) receive(message); }
        catch (error) {
          if (probe) report({ phase: 'failed', deadObject: String(error).includes('dead object') });
          else throw error;
        }
      });
      next.onDisconnect.addListener(() => disconnected(next));
      publish(true);
    } catch (_) { disconnected(port); }
  }
  window.addEventListener('pagehide', event => {
    if (!event.isTrusted || !pageAlive) return;
    pageAlive = false; publish(true, undefined, 'page-hidden'); stopWork(); refreshDocuments(new Set());
    if (retry !== null) clearTimeout(retry); retry = null;
    const old = port; port = null; try { old?.disconnect(); } catch (_) {}
  });
  window.addEventListener('pageshow', event => {
    if (event.isTrusted && event.persisted && !pageAlive) {
      beginDocumentEpoch(); pageAlive = true; attempts = 0; connect();
    }
  });
  window.addEventListener('resize', changed);
  document.addEventListener('DOMContentLoaded', changed);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', changed);
    window.visualViewport.addEventListener('scroll', changed);
  }
  connect();
})();
