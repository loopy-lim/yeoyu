import { expect, test } from "bun:test";

test("extension action tiles render per action and pass the press anchor", async () => {
  // Isolated like urlRuntime: bun shares the module registry across test
  // files, so the react-native mock must never leak into component tests
  // that load the real module (overlay.test.tsx).
  const probe = `
    import { mock } from 'bun:test';
    import React from 'react';
    import { act, create } from 'react-test-renderer';
    mock.module('react-native', () => ({
      View: 'View', Text: 'Text', Pressable: 'Pressable', Image: 'Image',
      StyleSheet: { create: (v) => v, hairlineWidth: 1 },
    }));
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const { ExtensionActionsBar } = await import('./src/components/ExtensionActionsBar');
    const actions = [
      { id: 'uBlock0@raymondhill.net', name: 'uBlock Origin', badge: '27',
        badgeBackgroundColor: '#1A73E8FF', badgeTextColor: '#FFFFFFFF',
        icon: 'data:image/png;base64,AAAA', actionEnabled: true },
      { id: 'addon@darkreader.org', name: 'Dark Reader', badge: '',
        badgeBackgroundColor: '', badgeTextColor: '', icon: '', actionEnabled: false },
    ];
    const opens = [];
    let empty, tree;
    await act(async () => { empty = create(React.createElement(ExtensionActionsBar, { actions: [], onOpen: () => {} })); });
    await act(async () => {
      tree = create(React.createElement(ExtensionActionsBar, {
        actions,
        onOpen: (action, anchor) => opens.push({ id: action.id, anchor }),
      }));
    });
    const find = (label) => tree.root.findByProps({ accessibilityLabel: label });
    const open = find('Open uBlock Origin controls');
    const dark = find('Open Dark Reader controls');
    await act(async () => open.props.onPress({ nativeEvent: { pageX: 48, pageY: 96 } }));
    const badges = tree.root.findAll((node) => node.props.children === '27').length;
    const iconImages = tree.root.findAll(
      (node) => node.type === 'Image' && node.props.source?.uri === 'data:image/png;base64,AAAA'
    ).length;
    const letterTiles = tree.root.findAll(
      (node) => node.type === 'Text' && node.props.children === 'D'
    ).length;
    console.log(JSON.stringify({
      emptyRendered: empty.toJSON() !== null,
      openState: open.props.accessibilityState,
      darkState: dark.props.accessibilityState,
      darkDisabled: dark.props.disabled,
      opens,
      badges,
      iconImages,
      letterTiles,
    }));
  `;
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
  expect(err.replace(/react-test-renderer is deprecated[^\n]*\n?/g, "")).toBe("");
  expect(code).toBe(0);
  const result = JSON.parse(out.trim());
  expect(result.emptyRendered).toBe(false);
  expect(result.openState).toEqual({ disabled: false });
  expect(result.darkState).toEqual({ disabled: true });
  expect(result.darkDisabled).toBe(true);
  expect(result.opens).toEqual([
    { id: "uBlock0@raymondhill.net", anchor: { x: 48, y: 96 } },
  ]);
  expect(result.badges).toBeGreaterThan(0);
  expect(result.iconImages).toBe(1);
  expect(result.letterTiles).toBe(1);
});
