import { expect, test } from "bun:test";

// The dashboard renders through react-native primitives whose module mocks
// conflict across suite files (first registration wins process-wide), so the
// interactions run in an isolated child bun process — the same probe pattern
// touchTargets uses for component renders. The probe prints one JSON object:
// { scenarios: [{ name, error }] } with error null when the scenario passed.
const probe = `
  import { mock } from 'bun:test';
  import React from 'react';
  import { act, create } from 'react-test-renderer';
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const View = React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({ measureInWindow: () => {} }));
    return React.createElement('View', props, props.children);
  });
  mock.module('react-native', () => ({
    View,
    Text: 'Text',
    TextInput: 'TextInput',
    Pressable: 'Pressable',
  }));
  mock.module('react-native-svg', () => ({
    default: 'Svg',
    Svg: 'Svg',
    Defs: 'Defs',
    LinearGradient: 'LinearGradient',
    Rect: 'Rect',
    Stop: 'Stop',
  }));
  mock.module('@unikit-bridge/ui', () => ({
    Button: (props) => React.createElement('UnikitButton', props),
  }));
  mock.module('./src/chrome/ChromeIcon', () => ({ ChromeIcon: 'ChromeIcon' }));
  mock.module('./src/components/Favicon', () => ({ Favicon: 'Favicon' }));
  // The dashboard owns no suggestion logic; the mock records what NewTabPage
  // hands AddressBox and offers one pressable that plays the role of a
  // selected open-tab suggestion (tabs/favorites carry result.page.tabId).
  let lastAddressProps = null;
  mock.module('./src/components/AddressBox', () => ({
    AddressBox: (props) => {
      lastAddressProps = props;
      return React.createElement('Pressable', {
        accessibilityLabel: 'Tab suggestion',
        onPress: () => props.onOpenTab?.('tab-existing'),
      });
    },
  }));
  const { NewTabPage, clockLabel } = await import('./src/components/NewTabPage');

  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const trees = [];
  const mount = (element) => {
    let tree;
    act(() => { tree = create(element); });
    trees.push(tree);
    return tree;
  };
  const button = (tree, label) => {
    const nodes = tree.root.findAll(
      (node) =>
        typeof node.type === 'string' &&
        typeof node.props.onPress === 'function' &&
        node.props.accessibilityLabel === label
    );
    assert(nodes.length === 1, 'expected one "' + label + '" pressable, got ' + nodes.length);
    return nodes[0];
  };
  const textInput = (tree, label) => {
    const nodes = tree.root.findAll(
      (node) => node.type === 'TextInput' && node.props.accessibilityLabel === label
    );
    assert(nodes.length === 1, 'expected one "' + label + '" input, got ' + nodes.length);
    return nodes[0];
  };
  const textContent = (tree) =>
    tree.root
      .findAll((node) => node.type === 'Text')
      .map((node) => String(node.props.children))
      .join('\\n');
  const press = (node) => act(() => { node.props.onPress(); });
  const changeText = (node, value) => act(() => { node.props.onChangeText(value); });
  const shortcuts = [{ id: 'gh', title: 'GitHub', url: 'https://github.com/' }];
  const mountPage = (overrides = {}) => mount(
    React.createElement(NewTabPage, {
      shortcuts,
      onSetShortcuts: () => {},
      keyboardInset: 0,
      visibleHeight: 800,
      reducedMotion: true,
      engine: 'google',
      suggestions: { favorites: [], bookmarks: [], tabs: [], history: [] },
      commands: [],
      onCommand: () => {},
      onOpenUrl: () => {},
      onOpenTab: () => {},
      ...overrides,
    })
  );
  const scenarios = [
    ['clock formats per language without seconds', () => {
      const date = new Date(2026, 10, 21, 15, 5);
      assert(clockLabel(date, 'en').time === '3:05 PM', 'en time: ' + clockLabel(date, 'en').time);
      assert(clockLabel(date, 'ko').time === '오후 3:05', 'ko time: ' + clockLabel(date, 'ko').time);
      assert(clockLabel(date, 'en').date === 'Saturday, November 21', 'en date: ' + clockLabel(date, 'en').date);
      assert(clockLabel(date, 'ko').date === '11월 21일 토요일', 'ko date: ' + clockLabel(date, 'ko').date);
    }],
    ['an empty dashboard explains the grid and offers adding a shortcut', () => {
      const tree = mountPage({ shortcuts: [] });
      assert(textContent(tree).includes(
        'Pin the sites you use for one-tap access from the new tab.'
      ), 'empty hint missing');
      button(tree, 'Add shortcut');
    }],
    ['pressing a shortcut opens its site in the blank tab', () => {
      const opened = [];
      const tree = mountPage({ onOpenUrl: (url) => opened.push(url) });
      press(button(tree, 'Open GitHub'));
      assert(JSON.stringify(opened) === '["https://github.com/"]', 'opened: ' + JSON.stringify(opened));
    }],
    ['edit mode turns tiles into removal targets', () => {
      const updates = [];
      const tree = mountPage({ onSetShortcuts: (next) => updates.push(next) });
      button(tree, 'Open GitHub');
      press(button(tree, 'Edit'));
      press(button(tree, 'Remove GitHub'));
      assert(JSON.stringify(updates) === '[[]]', 'updates: ' + JSON.stringify(updates));
      press(button(tree, 'Done'));
      button(tree, 'Add shortcut');
    }],
    ['adding validates the address before persisting', () => {
      const updates = [];
      const tree = mountPage({ shortcuts: [], onSetShortcuts: (next) => updates.push(next) });
      press(button(tree, 'Add shortcut'));
      const url = textInput(tree, 'Address');
      changeText(url, 'not a url');
      press(button(tree, 'Add shortcut'));
      assert(textContent(tree).includes('Enter a valid http(s) address.'), 'invalid message missing');
      assert(updates.length === 0, 'invalid add persisted');
      changeText(url, 'github.com');
      changeText(textInput(tree, 'Name (optional)'), 'Code');
      press(button(tree, 'Add shortcut'));
      assert(updates.length === 1, 'valid add did not persist');
      const added = updates[0][0];
      assert(/^shortcut-/.test(added.id), 'id prefix: ' + added.id);
      assert(added.title === 'Code', 'title: ' + added.title);
      assert(added.url === 'https://github.com/', 'url: ' + added.url);
      let missing = false;
      try { textInput(tree, 'Address'); } catch { missing = true; }
      assert(missing, 'form stayed open after persisting');
    }],
    ['adding rejects an address that already has a shortcut', () => {
      const updates = [];
      const tree = mountPage({ onSetShortcuts: (next) => updates.push(next) });
      press(button(tree, 'Add shortcut'));
      changeText(textInput(tree, 'Address'), 'https://github.com/');
      press(button(tree, 'Add shortcut'));
      assert(textContent(tree).includes('A shortcut for this address already exists.'), 'duplicate message missing');
      assert(updates.length === 0, 'duplicate add persisted');
    }],
    ['cancel dismisses the add form without persisting', () => {
      const updates = [];
      const tree = mountPage({ shortcuts: [], onSetShortcuts: (next) => updates.push(next) });
      press(button(tree, 'Add shortcut'));
      changeText(textInput(tree, 'Address'), 'example.com');
      press(button(tree, 'Cancel'));
      assert(updates.length === 0, 'cancel persisted');
      let missing = false;
      try { textInput(tree, 'Address'); } catch { missing = true; }
      assert(missing, 'form stayed open after cancel');
    }],
    ['selecting an open-tab suggestion switches to that tab, not a url load', () => {
      const openedTabs = [];
      const loadedUrls = [];
      const tree = mountPage({
        onOpenTab: (id) => openedTabs.push(id),
        onOpenUrl: (url) => loadedUrls.push(url),
      });
      assert(
        typeof lastAddressProps?.onOpenTab === 'function',
        'AddressBox did not receive onOpenTab from NewTabPage'
      );
      press(button(tree, 'Tab suggestion'));
      assert(
        JSON.stringify(openedTabs) === '["tab-existing"]',
        'openedTabs: ' + JSON.stringify(openedTabs)
      );
      assert(
        loadedUrls.length === 0,
        'tab suggestion fell through to a url load: ' + JSON.stringify(loadedUrls)
      );
    }],
  ];
  const results = [];
  for (const [name, run] of scenarios) {
    let error = null;
    try {
      run();
    } catch (failure) {
      error = failure && failure.message ? failure.message : String(failure);
    } finally {
      act(() => trees.splice(0).forEach((tree) => tree.unmount()));
    }
    results.push({ name, error });
  }
  console.log('@@RESULTS@@' + JSON.stringify({ scenarios: results }));
`;

test("new-tab dashboard scenarios pass in an isolated render process", async () => {
  const child = Bun.spawn([process.execPath, "-e", probe], {
    cwd: new URL("..", import.meta.url).pathname,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(code).toBe(0);
  const marker = out.lastIndexOf("@@RESULTS@@");
  expect(marker).toBeGreaterThan(-1);
  const results: { name: string; error: string | null }[] = JSON.parse(
    out.slice(marker + "@@RESULTS@@".length)
  ).scenarios;
  expect(results).toHaveLength(8);
  for (const scenario of results)
    expect(scenario.error).toBeNull();
  // A non-zero exit with results means an unhandled render error escaped.
  expect(err).not.toContain("SyntaxError");
});
