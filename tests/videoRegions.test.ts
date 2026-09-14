import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

const scriptPath = join(import.meta.dir, '../android/app/src/main/assets/yeoyu-video/content.js');
const script = readFileSync(scriptPath, 'utf8');

class Events {
  handlers = new Map<string, Set<(event: any) => void>>();
  addEventListener(type: string, handler: (event: any) => void) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
  }
  removeEventListener(type: string, handler: (event: any) => void) { this.handlers.get(type)?.delete(handler); }
  emit(type: string, extra = {}) { for (const fn of this.handlers.get(type) ?? []) fn({ type, isTrusted: true, ...extra }); }
}

const visibleStyle = {
  display: 'block', visibility: 'visible', opacity: '1', contentVisibility: 'visible',
  transform: 'none', rotate: 'none', scale: 'none', perspective: 'none', clipPath: 'none',
  maskImage: 'none', overflowX: 'visible', overflowY: 'visible',
  borderLeftWidth: '0px', borderTopWidth: '0px', borderRightWidth: '0px', borderBottomWidth: '0px',
  paddingLeft: '0px', paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px',
  objectFit: 'contain', objectPosition: '50% 50%',
};

class Element extends Events {
  tagName: string;
  parentElement: Element | null = null;
  ownerDocument: any;
  isConnected = true;
  css = { ...visibleStyle };
  rect = { x: 0, y: 0, width: 100, height: 100 };
  offsetWidth = 100;
  offsetHeight = 100;
  clientWidth = 100;
  clientHeight = 100;
  clientLeft = 0;
  clientTop = 0;
  paused = false;
  ended = false;
  readyState = 4;
  videoWidth = 640;
  videoHeight = 360;
  contentWindow: any;
  constructor(tagName: string, rect = { x: 100, y: 80, width: 640, height: 360 }) {
    super(); this.tagName = tagName; this.rect = rect;
    this.offsetWidth = this.clientWidth = rect.width;
    this.offsetHeight = this.clientHeight = rect.height;
  }
  getBoundingClientRect() {
    return { ...this.rect, left: this.rect.x, top: this.rect.y,
      right: this.rect.x + this.rect.width, bottom: this.rect.y + this.rect.height };
  }
  setAttribute() { throw new Error('The observer must never mutate page attributes'); }
  appendChild() { throw new Error('The observer must never move page nodes'); }
  remove() { throw new Error('The observer must never remove page nodes'); }
  play() { throw new Error('The observer must never control playback'); }
  pause() { throw new Error('The observer must never control playback'); }
  get src(): never { throw new Error('The observer must never read video URLs'); }
  get currentSrc(): never { throw new Error('The observer must never read video URLs'); }
  get style(): never { throw new Error('The observer must never access inline styles'); }
}

function page(width = 1000, height = 800) {
  const win: any = new Events();
  const doc: any = new Events();
  doc.nodes = [];
  doc.querySelectorAll = () => doc.nodes;
  doc.documentElement = new Element('HTML', { x: 0, y: 0, width, height });
  doc.documentElement.ownerDocument = doc;
  doc.visibilityState = 'visible';
  doc.readyState = 'complete';
  win.document = doc; doc.defaultView = win;
  win.innerWidth = width; win.innerHeight = height;
  win.devicePixelRatio = 1;
  win.visualViewport = Object.assign(new Events(), { width, height, offsetLeft: 0, offsetTop: 0, scale: 1 });
  win.getComputedStyle = (node: Element) => node.css;
  win.top = win; win.parent = win;
  return { win, doc, add(node: Element) { node.ownerDocument = doc; node.parentElement = doc.documentElement; doc.nodes.push(node); return node; } };
}

function harness() {
  const p = page();
  const messages: any[] = [];
  let receiver: (message: any) => void = () => {};
  let disconnect: () => void = () => {};
  let clock = 0, nextId = 0;
  const raf = new Map<number, (time: number) => void>();
  const intervals = new Map<number, () => void>();
  const timeouts = new Map<number, { fn: () => void; at: number }>();
  let connections = 0;
  const port = {
    postMessage: (message: any) => messages.push(JSON.parse(JSON.stringify(message))),
    onMessage: { addListener: (fn: typeof receiver) => { receiver = fn; } },
    onDisconnect: { addListener: (fn: typeof disconnect) => { disconnect = fn; } },
    disconnect() {},
  };
  const context = {
    window: p.win, document: p.doc, performance: { now: () => clock },
    crypto: { randomUUID: () => `document-${++nextId}` },
    browser: { runtime: { connectNative(name: string) { expect(name).toBe('yeoyu_video'); connections++; return port; } } },
    requestAnimationFrame: (fn: (time: number) => void) => { const id = ++nextId; raf.set(id, fn); return id; },
    cancelAnimationFrame: (id: number) => raf.delete(id),
    setInterval: (fn: () => void) => { const id = ++nextId; intervals.set(id, fn); return id; },
    clearInterval: (id: number) => intervals.delete(id),
    setTimeout: (fn: () => void, delay: number) => { const id = ++nextId; timeouts.set(id, { fn, at: clock + delay }); return id; },
    clearTimeout: (id: number) => timeouts.delete(id),
  };
  return { ...p, messages, start() { runInNewContext(script, context); },
    send(message: any) { receiver(message); },
    measure(diagnostics = false) { receiver({ type: 'measure', requestId: 'fresh', diagnostics }); return messages.at(-1); },
    frame(ms: number) { clock = ms; const pending = [...raf.values()]; raf.clear(); pending.forEach(fn => fn(ms)); },
    heartbeat(ms: number) { clock = ms; [...intervals.values()].forEach(fn => fn()); },
    disconnect() { disconnect(); },
    time(ms: number) { clock = ms; for (const [id, timer] of [...timeouts]) if (timer.at <= clock) { timeouts.delete(id); timer.fn(); } },
    connections: () => connections,
    pending: () => raf.size + intervals.size,
  };
}

test('fresh measurement reports the playing picture without touching its DOM, URL or playback', () => {
  const h = harness(); h.add(new Element('VIDEO')); h.start();
  const message = h.measure();
  expect(message).toMatchObject({ type: 'video-region', requestId: 'fresh', playing: true,
    rect: { x: 100, y: 80, width: 640, height: 360 }, videoWidth: 640, videoHeight: 360,
    viewport: { width: 1000, height: 800, visualWidth: 1000, visualHeight: 800, offsetLeft: 0, offsetTop: 0, scale: 1 } });
  expect(message.documentToken).toBeTruthy(); expect(message.videoToken).toBeTruthy();
});

test('paused larger video does not displace the playing video and centered contain removes letterboxing', () => {
  const h = harness();
  const paused = h.add(new Element('VIDEO', { x: 0, y: 0, width: 1000, height: 700 })); paused.paused = true;
  h.add(new Element('VIDEO', { x: 100, y: 80, width: 640, height: 480 })); h.start();
  expect(h.measure()?.rect).toEqual({ x: 100, y: 140, width: 640, height: 360 });
});

test('same-origin iframe border and positive axis scale compose into top-level coordinates', () => {
  const h = harness(); const child = page(400, 300);
  const frame = h.add(new Element('IFRAME', { x: 50, y: 40, width: 808, height: 608 }));
  frame.offsetWidth = 404; frame.offsetHeight = 304; frame.clientWidth = 400; frame.clientHeight = 300;
  frame.clientLeft = frame.clientTop = 2;
  Object.assign(frame.css, { borderLeftWidth: '2px', borderTopWidth: '2px', borderRightWidth: '2px', borderBottomWidth: '2px', transform: 'matrix(2, 0, 0, 2, 0, 0)' });
  frame.contentWindow = child.win;
  const video = child.add(new Element('VIDEO', { x: 10, y: 20, width: 320, height: 180 }));
  video.videoWidth = 320; video.videoHeight = 180;
  h.start(); expect(h.measure()?.rect).toEqual({ x: 74, y: 84, width: 640, height: 360 });
});

test('cross-origin frames cannot supply untrusted coordinates', () => {
  const h = harness(); const frame = h.add(new Element('IFRAME'));
  frame.contentWindow = { get document() { throw new Error('SecurityError'); } };
  h.start(); expect(h.measure()).toMatchObject({ rect: null, playing: false });
});

test('a restricted iframe cannot hide a later valid top-level player from discovery', () => {
  const h = harness(); const frame = h.add(new Element('IFRAME'));
  frame.contentWindow = { get document() { throw new Error('SecurityError'); } };
  h.add(new Element('VIDEO')); h.start();
  expect(h.measure()).toMatchObject({ playing: true, rect: { width: 640 } });
});

test('a late same-origin iframe load registers its playback events for passive Home readiness', () => {
  const h = harness(); const child = page(640, 360);
  const frame = h.add(new Element('IFRAME', { x: 100, y: 80, width: 640, height: 360 }));
  h.start(); frame.contentWindow = child.win;
  const video = child.add(new Element('VIDEO', { x: 0, y: 0, width: 640, height: 360 })); video.paused = true;
  h.doc.emit('load', { target: frame });
  video.paused = false; child.doc.emit('play', { target: video });
  expect(h.messages.at(-1)).toMatchObject({ playing: true, rect: { x: 100, y: 80, width: 640, height: 360 } });
  const count = h.messages.length; h.heartbeat(300); expect(h.messages.length).toBe(count + 1);
});

test('a removed dead iframe document cannot stop fresh top-level measurements or heartbeats', () => {
  const h = harness(); const child = page(640, 360);
  const frame = h.add(new Element('IFRAME')); frame.contentWindow = child.win;
  h.add(new Element('VIDEO')); h.start();
  let deadAccesses = 0;
  child.doc.removeEventListener = () => { deadAccesses++; throw new Error("can't access dead object"); };
  h.doc.nodes = h.doc.nodes.filter((node: Element) => node !== frame);
  const count = h.messages.length;
  expect(h.measure()).toMatchObject({ requestId: 'fresh', playing: true, rect: { width: 640 } });
  expect(h.messages.length).toBe(count + 1);
  h.heartbeat(300); expect(h.messages.length).toBe(count + 2);
  expect(deadAccesses).toBe(1);
});

test('dead iframe cleanup cannot prevent transport reconnection for the surviving document', () => {
  const h = harness(); const child = page(640, 360);
  const frame = h.add(new Element('IFRAME')); frame.contentWindow = child.win;
  h.add(new Element('VIDEO')); h.start(); const original = h.measure();
  child.doc.removeEventListener = () => { throw new Error("can't access dead object"); };
  h.doc.nodes = h.doc.nodes.filter((node: Element) => node !== frame);
  h.disconnect(); h.time(250);
  expect(h.connections()).toBe(2);
  expect(h.measure()).toMatchObject({ playing: true, documentToken: original.documentToken,
    videoToken: original.videoToken, rect: original.rect });
});

test('partial listener registration failure in one iframe does not block other documents', () => {
  const h = harness(); const broken = page(640, 360); const healthy = page(320, 180);
  const brokenFrame = h.add(new Element('IFRAME')); brokenFrame.contentWindow = broken.win;
  const healthyFrame = h.add(new Element('IFRAME', { x: 20, y: 20, width: 320, height: 180 }));
  healthyFrame.contentWindow = healthy.win;
  const topVideo = h.add(new Element('VIDEO')); topVideo.paused = true;
  const childVideo = healthy.add(new Element('VIDEO', { x: 0, y: 0, width: 320, height: 180 }));
  childVideo.paused = true;
  broken.doc.addEventListener = (type: string, listener: (event: any) => void) => {
    if (type === 'pause') throw new Error("can't access dead object");
    Events.prototype.addEventListener.call(broken.doc, type, listener);
  };
  h.start(); expect(h.messages.at(-1)).toMatchObject({ playing: false });
  childVideo.paused = false; healthy.doc.emit('play');
  expect(h.messages.at(-1)).toMatchObject({ playing: true, rect: { x: 20, y: 20, width: 320 } });
  childVideo.paused = true; healthy.doc.emit('pause');
  topVideo.paused = false; h.doc.emit('play');
  expect(h.messages.at(-1)).toMatchObject({ playing: true, rect: { x: 100, y: 80, width: 640 } });
  const count = h.messages.length; broken.doc.emit('play');
  expect(h.messages.length).toBe(count);
});

test.each(['hidden', 'clipped', 'rotated', 'pinched', 'offscreen'])('%s video fails closed', kind => {
  const h = harness(); const video = h.add(new Element('VIDEO'));
  if (kind === 'hidden') h.doc.documentElement.css.visibility = 'hidden';
  if (kind === 'clipped') {
    const clip = h.add(new Element('DIV', { x: 0, y: 0, width: 500, height: 800 }));
    clip.css.overflowX = 'hidden'; video.parentElement = clip;
  }
  if (kind === 'rotated') video.css.transform = 'matrix(0, 1, -1, 0, 0, 0)';
  if (kind === 'pinched') h.win.visualViewport.scale = 2;
  if (kind === 'offscreen') video.rect.x = -10;
  h.start(); expect(h.measure()).toMatchObject({ rect: null, playing: false });
});

test('watch suppresses identical frames, reports motion and provides a bounded heartbeat', () => {
  const h = harness(); const video = h.add(new Element('VIDEO')); h.start();
  const first = h.measure(); h.send({ type: 'watch', enabled: true, videoToken: first?.videoToken, watchId: 'lease-1' });
  const start = h.messages.length; h.frame(16); h.frame(32); expect(h.messages.length).toBe(start);
  video.rect.x = 120; h.frame(48);
  expect(h.messages.at(-1)).toMatchObject({ rect: { x: 120 }, watchId: 'lease-1' });
  const count = h.messages.length; h.heartbeat(300); expect(h.messages.length).toBe(count + 1);
  expect(h.messages.at(-1).sequence).toBeGreaterThan(first.sequence);
});

test('removed watched video invalidates instead of switching to a different playing video', () => {
  const h = harness(); const firstVideo = h.add(new Element('VIDEO')); h.start(); const first = h.measure();
  h.send({ type: 'watch', enabled: true, videoToken: first?.videoToken, watchId: 'lease-1' });
  firstVideo.isConnected = false; h.add(new Element('VIDEO')); h.frame(16);
  expect(h.messages.at(-1)).toMatchObject({ rect: null, playing: false, videoToken: first?.videoToken, watchId: 'lease-1' });
});

test('stopping a watch prevents queued work from sending another lease update', () => {
  const h = harness(); h.add(new Element('VIDEO')); h.start(); const first = h.measure();
  h.send({ type: 'watch', enabled: true, videoToken: first?.videoToken, watchId: 'lease-1' });
  h.send({ type: 'watch', enabled: false, watchId: 'lease-1' });
  const count = h.messages.length; h.frame(16); expect(h.messages.length).toBe(count);
  h.heartbeat(300); expect(h.messages.at(-1)?.watchId).toBeUndefined();
});

test('playing passive reports stay fresh without a watch and stop when playback ends', () => {
  const h = harness(); const video = h.add(new Element('VIDEO')); h.start();
  const count = h.messages.length; h.heartbeat(300);
  expect(h.messages.length).toBe(count + 1);
  expect(h.messages.at(-1)).toMatchObject({ playing: true });
  expect(h.messages.at(-1).watchId).toBeUndefined();
  video.paused = true; h.doc.emit('pause'); const pausedCount = h.messages.length;
  h.heartbeat(600); expect(h.messages.length).toBe(pausedCount);
  expect(h.pending()).toBe(0);
});

test('one-off measurement can describe a paused video but cannot call it playing', () => {
  const h = harness(); h.add(new Element('VIDEO')).paused = true; h.start();
  expect(h.measure()).toMatchObject({ rect: { x: 100, y: 80, width: 640, height: 360 }, playing: false });
});

for (const readyState of [2, 4]) test(`natural end invalidates a watched video with readyState ${readyState} while pause keeps its picture`, () => {
  const h = harness(); const video = h.add(new Element('VIDEO')); video.readyState = readyState;
  h.start(); const first = h.measure();
  h.send({ type: 'watch', enabled: true, videoToken: first.videoToken, watchId: 'ending' });
  video.paused = true; h.doc.emit('pause');
  expect(h.messages.at(-1)).toMatchObject({ rect: first.rect, playing: false, watchId: 'ending', videoToken: first.videoToken });
  video.ended = true; h.doc.emit('ended');
  expect(h.messages.at(-1)).toMatchObject({ rect: null, playing: false, watchId: 'ending', videoToken: first.videoToken });
  h.heartbeat(1600);
  expect(h.messages.at(-1)).toMatchObject({ rect: null, watchId: 'ending' });
});

test('discovery excludes a finished video even when its last picture is larger than a paused candidate', () => {
  const h = harness();
  const ended = h.add(new Element('VIDEO', { x: 0, y: 0, width: 960, height: 540 }));
  ended.paused = true; ended.ended = true;
  const paused = h.add(new Element('VIDEO', { x: 100, y: 80, width: 320, height: 180 })); paused.paused = true;
  h.start();
  expect(h.measure()).toMatchObject({ rect: paused.rect, playing: false });
  paused.isConnected = false;
  expect(h.measure()).toMatchObject({ rect: null, playing: false });
});

test('replaying a finished element can establish a new watch without reviving the ended lease', () => {
  const h = harness(); const video = h.add(new Element('VIDEO')); h.start(); const first = h.measure();
  h.send({ type: 'watch', enabled: true, videoToken: first.videoToken, watchId: 'old' });
  video.paused = true; video.ended = true; h.doc.emit('ended');
  h.send({ type: 'watch', enabled: false, watchId: 'old' });
  video.ended = false; video.paused = false; h.doc.emit('playing');
  const replay = h.measure();
  expect(replay).toMatchObject({ rect: first.rect, playing: true, videoToken: first.videoToken });
  expect(replay.watchId).toBeUndefined();
  h.send({ type: 'watch', enabled: true, videoToken: replay.videoToken, watchId: 'replay' });
  h.send({ type: 'watch', enabled: false, watchId: 'old' });
  h.heartbeat(1600);
  expect(h.messages.at(-1)).toMatchObject({ rect: first.rect, playing: true, watchId: 'replay' });
});

test('the finite-end fixture only disables looping and never seeks before natural end', () => {
  const html = readFileSync(join(import.meta.dir, 'fixtures/system-pip.html'), 'utf8');
  const start = html.indexOf("  if (new URL(location.href).searchParams.get('finishAfter') === '20')");
  const end = html.indexOf("  document.addEventListener('visibilitychange'", start);
  expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
  const video = Object.assign(new Events(), { loop: true, duration: 8, currentTime: 4 });
  Object.defineProperty(video, 'currentTime', { get: () => 4, set: () => { throw Error('Natural-end validation must not seek'); } });
  const receipts: string[] = []; const timers: { fn: () => void; delay: number }[] = [];
  runInNewContext(html.slice(start, end), {
    video, URL, location: { href: 'http://127.0.0.1:8877/system-pip.html?finishAfter=20' },
    record: (kind: string) => receipts.push(kind),
    setTimeout: (fn: () => void, delay: number) => timers.push({ fn, delay }),
  });
  video.emit('playing');
  expect(video.loop).toBe(true); expect(timers.map(timer => timer.delay)).toEqual([20_000]);
  timers[0]!.fn();
  expect(video.loop).toBe(false); expect(video.currentTime).toBe(4);
  expect(receipts).toEqual(['end-scheduled', 'end-loop-disabled']);
});

test('pagehide invalidates geometry and BFCache pageshow starts a new document epoch', () => {
  const h = harness(); h.add(new Element('VIDEO')); h.start(); const first = h.measure();
  h.send({ type: 'watch', enabled: true, videoToken: first?.videoToken, watchId: 'lease-1' });
  h.win.emit('pagehide', { persisted: true });
  expect(h.messages.at(-1)).toMatchObject({ rect: null, reason: 'page-hidden', watchId: 'lease-1' });
  expect(h.pending()).toBe(0);
  h.win.emit('pageshow', { persisted: true });
  const restored = h.measure();
  expect(restored?.documentToken).not.toBe(first?.documentToken);
  expect(restored?.videoToken).not.toBe(first?.videoToken);
});

test('port disconnect stops all geometry work', () => {
  const h = harness(); h.add(new Element('VIDEO')); h.start(); const first = h.measure();
  h.send({ type: 'watch', enabled: true, videoToken: first?.videoToken, watchId: 'lease-1' });
  h.disconnect(); const count = h.messages.length; h.frame(20); h.heartbeat(300);
  expect(h.pending()).toBe(0); expect(h.messages.length).toBe(count);
});

test('watch pause keeps the same valid picture and resume keeps the original video token', () => {
  const h = harness(); const video = h.add(new Element('VIDEO')); h.start(); const first = h.measure();
  h.send({ type: 'watch', enabled: true, videoToken: first?.videoToken, watchId: 'lease-1' });
  video.paused = true; h.frame(16);
  expect(h.messages.at(-1)).toMatchObject({ playing: false, rect: { width: 640 }, videoToken: first?.videoToken });
  video.paused = false; h.frame(32);
  expect(h.messages.at(-1)).toMatchObject({ playing: true, videoToken: first?.videoToken });
});

test('old watch disable cannot stop a newer lease for the same video', () => {
  const h = harness(); const video = h.add(new Element('VIDEO')); h.start(); const first = h.measure();
  h.send({ type: 'watch', enabled: true, videoToken: first.videoToken, watchId: 'lease-1' });
  h.send({ type: 'watch', enabled: true, videoToken: first.videoToken, watchId: 'lease-2' });
  h.send({ type: 'watch', enabled: false, watchId: 'lease-1' });
  video.rect.x = 110; h.frame(20);
  expect(h.messages.at(-1)).toMatchObject({ rect: { x: 110 }, watchId: 'lease-2' });
});

test('missing native receiver gets a bounded reconnect backoff instead of permanent polling', () => {
  const h = harness(); h.add(new Element('VIDEO')); h.start();
  h.disconnect(); h.time(249); expect(h.connections()).toBe(1);
  h.time(250); expect(h.connections()).toBe(2);
  h.disconnect(); h.time(1250); expect(h.connections()).toBe(3);
  h.disconnect(); h.time(5250); expect(h.connections()).toBe(4);
  h.disconnect(); h.time(60000); expect(h.connections()).toBe(4);
});

test('native acknowledgement restores the retry budget across repeated healthy reconnections', () => {
  const h = harness(); h.add(new Element('VIDEO')); h.start();
  const original = h.measure();
  let previousSequence = original.sequence;
  for (let reconnect = 1; reconnect <= 5; reconnect++) {
    h.send({ type: 'connected', documentToken: original.documentToken });
    h.disconnect();
    h.time(reconnect * 250 - 1); expect(h.connections()).toBe(reconnect);
    h.time(reconnect * 250); expect(h.connections()).toBe(reconnect + 1);
    const current = h.measure();
    expect(current.documentToken).toBe(original.documentToken);
    expect(current.videoToken).toBe(original.videoToken);
    expect(current.sequence).toBeGreaterThan(previousSequence);
    expect(current.playing).toBe(true);
    previousSequence = current.sequence;
  }
});

test('acknowledgement for another document cannot renew failed connection attempts', () => {
  const h = harness(); h.add(new Element('VIDEO')); h.start();
  const wrongDocument = `${h.measure().documentToken}-retired`;
  for (const [before, due, count] of [[249, 250, 2], [1249, 1250, 3], [5249, 5250, 4]]) {
    h.send({ type: 'connected', documentToken: wrongDocument });
    h.disconnect(); h.time(before); expect(h.connections()).toBe(count - 1);
    h.time(due); expect(h.connections()).toBe(count);
  }
  h.send({ type: 'connected', documentToken: wrongDocument });
  h.disconnect(); h.time(60000); expect(h.connections()).toBe(4);
});

test('navigation disconnect cannot give the outgoing DOM a fresh identity before pagehide', () => {
  const h = harness(); h.add(new Element('VIDEO')); h.start(); const outgoing = h.measure();
  // Native has retired this document at the next navigation's onPageStart; pagehide is still pending.
  h.disconnect(); h.time(250);
  const reconnect = h.measure();
  expect(reconnect.documentToken).toBe(outgoing.documentToken);
  expect(reconnect.videoToken).toBe(outgoing.videoToken);
  expect(reconnect.sequence).toBeGreaterThan(outgoing.sequence);
  expect(reconnect.rect).toEqual(outgoing.rect);
});

test('page-created lifecycle events cannot manufacture a new document epoch', () => {
  const h = harness(); h.add(new Element('VIDEO')); h.start(); const original = h.measure();
  h.win.emit('pagehide', { persisted: true, isTrusted: false });
  h.win.emit('pageshow', { persisted: true, isTrusted: false });
  const after = h.measure();
  expect(after.documentToken).toBe(original.documentToken);
  expect(after.videoToken).toBe(original.videoToken);
  expect(h.connections()).toBe(1);
});

test('explicit diagnostics identify the largest rejected playing video without changing selection', () => {
  const h = harness();
  const large = h.add(new Element('VIDEO'));
  large.css.transform = 'matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)';
  h.add(new Element('VIDEO', { x: 20, y: 20, width: 160, height: 90 })); h.start();
  const ordinary = h.measure(); const measured = h.measure(true);
  expect(measured.rect).toEqual(ordinary.rect);
  expect(measured.videoToken).toBe(ordinary.videoToken);
  expect(measured.diagnostic).toMatchObject({ gate: 'transform', inspectedVideos: 2, playingVideos: 2,
    rect: large.rect, ancestorDepth: 0, transformKind: 'matrix3d',
    transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] });
});

test('diagnostic failure explains a null selection with safe ancestor opacity and numeric viewport', () => {
  const h = harness(); h.add(new Element('VIDEO'));
  h.doc.documentElement.css.opacity = '0.99'; h.start();
  expect(h.measure(true)).toMatchObject({ rect: null, diagnostic: { gate: 'opacity', opacity: 0.99,
    ancestorDepth: 1, viewport: { width: 1000, height: 800, scale: 1 } } });
});

test('clipping diagnostics expose the exact numeric ancestor boundary and constrained axes', () => {
  const h = harness(); const video = h.add(new Element('VIDEO'));
  const clip = h.add(new Element('DIV', { x: 0, y: 0, width: 738.99, height: 800 }));
  clip.css.overflowX = 'hidden'; video.parentElement = clip; h.start();
  expect(h.measure(true)).toMatchObject({ rect: null, diagnostic: { gate: 'clipped', ancestorDepth: 1,
    clipX: true, clipY: false, clipBounds: { x: 0, y: 0, width: 738.99, height: 800 } } });
});

test('observed YouTube fractional ancestor height crops inward after original object-fit', () => {
  const h = harness(); h.win.devicePixelRatio = 2.5;
  const video = h.add(new Element('VIDEO', { x: 16, y: 68, width: 656, height: 275 }));
  video.videoWidth = 1920; video.videoHeight = 804;
  const wrapper = h.add(new Element('DIV', { x: 16, y: 68, width: 656, height: 275 }));
  const clip = h.add(new Element('DIV', { x: 16, y: 68, width: 656, height: 274.816650390625 }));
  clip.offsetHeight = clip.clientHeight = 275;
  Object.assign(clip.css, { overflowX: 'hidden', overflowY: 'hidden' });
  video.parentElement = wrapper; wrapper.parentElement = clip; h.start();
  const measured = h.measure(true);
  expect(measured).toMatchObject({ playing: true, rect: { x: 16, width: 656 }, diagnostic: { gate: 'accepted' } });
  // Original 656 * 804 / 1920 picture is 274.7 high, centered at y=68.15.
  expect(measured.rect.y).toBeCloseTo(68.15, 8);
  expect(measured.rect.height).toBeCloseTo(274.666650390625, 8);
  expect(measured.rect.y + measured.rect.height).toBeLessThanOrEqual(342.816650390625);
});

test.each(['contain', 'fill'])('observed 1280x536 player stays inside its fractional ancestor with object-fit %s', objectFit => {
  const h = harness(); h.win.devicePixelRatio = 2.5;
  const video = h.add(new Element('VIDEO', { x: 16, y: 68, width: 656, height: 275 }));
  video.videoWidth = 1280; video.videoHeight = 536; video.css.objectFit = objectFit;
  const wrapper = h.add(new Element('DIV', { x: 16, y: 68, width: 656, height: 275 }));
  const clip = h.add(new Element('DIV', { x: 16, y: 68, width: 656, height: 274.70001220703125 }));
  clip.offsetHeight = clip.clientHeight = 275;
  Object.assign(clip.css, { overflowX: 'hidden', overflowY: 'hidden' });
  video.parentElement = wrapper; wrapper.parentElement = clip; h.start();
  const measured = h.measure(true);
  expect(measured).toMatchObject({ playing: true, rect: { x: 16, width: 656 }, diagnostic: { gate: 'accepted' } });
  const expectedTop = objectFit === 'contain' ? 68.15 : 68;
  expect(measured.rect.y).toBeCloseTo(expectedTop, 8);
  expect(measured.rect.height).toBeCloseTo(342.70001220703125 - expectedTop, 8);
  expect(measured.rect.y + measured.rect.height).toBeLessThanOrEqual(342.70001220703125);
});

test.each([1, 1.5, 2.5, 3])('overflow uses one CSS pixel per edge regardless of DPR %s', dpr => {
  for (const inset of [1, 1.00001]) {
    const h = harness(); h.win.devicePixelRatio = dpr;
    const video = h.add(new Element('VIDEO'));
    const clip = h.add(new Element('DIV', { x: 100 + inset, y: 80 + inset,
      width: 640 - 2 * inset, height: 360 - 2 * inset }));
    Object.assign(clip.css, { overflowX: 'hidden', overflowY: 'hidden' });
    video.parentElement = clip; h.start(); const measured = h.measure();
    if (inset > 1) expect(measured).toMatchObject({ playing: false, rect: null });
    else expect(measured).toMatchObject({ playing: true,
      rect: { x: 101, y: 81, width: 638, height: 358 } });
  }
});

test('fractional clipping of letterboxing leaves the original picture placement unchanged', () => {
  const h = harness(); h.win.devicePixelRatio = 2.5;
  const video = h.add(new Element('VIDEO', { x: 100, y: 80, width: 640, height: 480 }));
  const clip = h.add(new Element('DIV', { x: 100, y: 80, width: 640, height: 479.816650390625 }));
  clip.css.overflowY = 'hidden'; video.parentElement = clip; h.start();
  expect(h.measure()).toMatchObject({ playing: true, rect: { x: 100, y: 140, width: 640, height: 360 } });
});

test.each([0.5, 0.50001])('scaled iframe clipping %s stays bounded by one top-level CSS pixel', inset => {
  const h = harness(); const child = page(400, 300);
  h.win.devicePixelRatio = child.win.devicePixelRatio = 2.5;
  const frame = h.add(new Element('IFRAME', { x: 50, y: 40, width: 800, height: 600 }));
  frame.offsetWidth = frame.clientWidth = 400; frame.offsetHeight = frame.clientHeight = 300;
  frame.css.transform = 'matrix(2, 0, 0, 2, 0, 0)'; frame.contentWindow = child.win;
  const video = child.add(new Element('VIDEO', { x: 10, y: 20, width: 320, height: 180 }));
  const clip = child.add(new Element('DIV', { x: 10, y: 20, width: 320 - inset, height: 180 }));
  clip.css.overflowX = 'hidden'; video.parentElement = clip; h.start();
  const measured = h.measure();
  if (inset > 0.5) expect(measured).toMatchObject({ playing: false, rect: null });
  else {
    expect(measured).toMatchObject({ playing: true, rect: { x: 70, y: 80, height: 360 } });
    expect(measured.rect.width).toBeCloseTo(639, 8);
  }
});

test.each([0.25, 0.25001])('nested iframe clipping %s cannot accumulate more than one root CSS pixel', inset => {
  const h = harness(); const child = page(400, 300); const nested = page(200, 150);
  h.win.devicePixelRatio = child.win.devicePixelRatio = nested.win.devicePixelRatio = 2.5;
  const outerFrame = h.add(new Element('IFRAME', { x: 50, y: 40, width: 800, height: 600 }));
  outerFrame.offsetWidth = outerFrame.clientWidth = 400; outerFrame.offsetHeight = outerFrame.clientHeight = 300;
  outerFrame.css.transform = 'matrix(2, 0, 0, 2, 0, 0)'; outerFrame.contentWindow = child.win;
  const innerFrame = child.add(new Element('IFRAME', { x: 0, y: 0, width: 400, height: 300 }));
  innerFrame.offsetWidth = innerFrame.clientWidth = 200; innerFrame.offsetHeight = innerFrame.clientHeight = 150;
  innerFrame.css.transform = 'matrix(2, 0, 0, 2, 0, 0)'; innerFrame.contentWindow = nested.win;
  const video = nested.add(new Element('VIDEO', { x: 10, y: 20, width: 160, height: 90 }));
  const clip = nested.add(new Element('DIV', { x: 10, y: 20, width: 160 - inset, height: 90 }));
  clip.css.overflowX = 'hidden'; video.parentElement = clip; h.start();
  const measured = h.measure();
  if (inset > 0.25) expect(measured).toMatchObject({ playing: false, rect: null });
  else {
    expect(measured).toMatchObject({ playing: true, rect: { x: 90, y: 120, height: 360 } });
    expect(measured.rect.width).toBeCloseTo(639, 8);
  }
});

test.each([1, 1.2])('successive ancestor clipping %s stays locally bounded even inside a downscaled iframe', totalInset => {
  const h = harness(); const child = page();
  h.win.devicePixelRatio = child.win.devicePixelRatio = 2.5;
  const frame = h.add(new Element('IFRAME', { x: 50, y: 40, width: 500, height: 400 }));
  frame.offsetWidth = frame.clientWidth = 1000; frame.offsetHeight = frame.clientHeight = 800;
  frame.css.transform = 'matrix(0.5, 0, 0, 0.5, 0, 0)'; frame.contentWindow = child.win;
  const video = child.add(new Element('VIDEO'));
  const inner = child.add(new Element('DIV', { x: 100.6, y: 80, width: 639.4, height: 360 }));
  const outer = child.add(new Element('DIV', { x: 100 + totalInset, y: 80, width: 640 - totalInset, height: 360 }));
  inner.css.overflowX = outer.css.overflowX = 'hidden';
  video.parentElement = inner; inner.parentElement = outer; h.start();
  const measured = h.measure();
  if (totalInset > 1) expect(measured).toMatchObject({ playing: false, rect: null });
  else expect(measured).toMatchObject({ playing: true, rect: { x: 100.5, y: 80, width: 319.5, height: 180 } });
});

test('zero-height clipping diagnostics identify boxes without page identifiers', () => {
  const h = harness(); const video = h.add(new Element('VIDEO'));
  const clip = h.add(new Element('DIV', { x: 0, y: 0, width: 1000, height: 0 }));
  Object.assign(clip.css, { overflowX: 'hidden', overflowY: 'hidden' });
  video.parentElement = clip;
  h.start();
  expect(h.measure(true)).toMatchObject({ rect: null, diagnostic: { gate: 'clipped', clipBounds: null,
    clipElement: { role: 'element', display: 'block',
      box: { x: 0, y: 0, width: 1000, height: 0 },
      offsetWidth: 1000, offsetHeight: 0, clientWidth: 1000, clientHeight: 0 } } });
});

test('root overflow clips at the viewport even when its own layout box has zero height', () => {
  const h = harness(); h.add(new Element('VIDEO'));
  Object.assign(h.doc.documentElement.css, { overflowX: 'hidden', overflowY: 'hidden' });
  h.doc.documentElement.rect.height = h.doc.documentElement.offsetHeight = 0;
  h.start();
  expect(h.measure(true)).toMatchObject({ playing: true, rect: { x: 100, y: 80, width: 640, height: 360 },
    diagnostic: { gate: 'accepted' } });
});

test('body overflow propagates only through an uncontained HTML root with both axes visible', () => {
  const h = harness(); const video = h.add(new Element('VIDEO'));
  const body = h.add(new Element('BODY', { x: 0, y: 0, width: 1000, height: 0 }));
  h.doc.body = body; video.parentElement = body;
  Object.assign(body.css, { overflowX: 'hidden', overflowY: 'hidden' });
  h.start(); expect(h.measure()).toMatchObject({ playing: true });
  h.doc.documentElement.css.overflowX = 'auto';
  expect(h.measure()).toMatchObject({ playing: false, rect: null });
  h.doc.documentElement.css.overflowX = 'visible';
  Object.assign(body.css, { contain: 'paint' });
  expect(h.measure()).toMatchObject({ playing: false, rect: null });
  Object.assign(body.css, { contain: 'none' });
  Object.assign(h.doc.documentElement.css, { contain: 'layout' });
  expect(h.measure()).toMatchObject({ playing: false, rect: null });
});

test('diagnostics distinguish no video from unsafe viewport without exporting page strings', () => {
  const h = harness(); h.start();
  expect(h.measure(true).diagnostic.gate).toBe('no-playing-video');
  const video = h.add(new Element('VIDEO')); h.win.visualViewport.scale = 2;
  expect(h.measure(true).diagnostic.gate).toBe('viewport');
  h.win.visualViewport.scale = 1;
  video.css.maskImage = 'url(https://private.example/secret)';
  const measured = h.measure(true);
  expect(measured.diagnostic.gate).toBe('mask');
  expect(JSON.stringify(measured.diagnostic)).not.toContain('private');
  expect(JSON.stringify(measured.diagnostic)).not.toContain('url');
});

test('diagnostics are request-only and cannot disturb unchanged watch frame suppression', () => {
  const h = harness(); h.add(new Element('VIDEO')); h.start(); const first = h.measure();
  h.send({ type: 'watch', enabled: true, videoToken: first.videoToken, watchId: 'lease', diagnostics: true });
  expect(h.messages.every(message => message.diagnostic === undefined)).toBe(true);
  expect(h.measure(true).diagnostic.gate).toBe('accepted');
  const count = h.messages.length; h.frame(16); expect(h.messages.length).toBe(count);
  h.heartbeat(300); expect(h.messages.at(-1).diagnostic).toBeUndefined();
  h.send({ type: 'measure', requestId: 'not-opted-in', diagnostics: 'true' });
  expect(h.messages.at(-1).diagnostic).toBeUndefined();
});

test('explicit diagnostics bound video and ancestor inspection', () => {
  const h = harness();
  for (let i = 0; i < 8; i++) h.add(new Element('VIDEO')).paused = true;
  const extra = h.add(new Element('VIDEO'));
  h.start();
  expect(h.measure(true).diagnostic).toMatchObject({ inspectedVideos: 8, playingVideos: 0, gate: 'no-playing-video' });
  h.doc.nodes = [extra];
  let node = extra;
  for (let i = 0; i < 25; i++) {
    const parent = new Element('DIV', { x: 0, y: 0, width: 1000, height: 800 });
    parent.ownerDocument = h.doc; node.parentElement = parent; node = parent;
  }
  expect(h.measure(true).diagnostic.gate).toBe('ancestor-limit');
});
