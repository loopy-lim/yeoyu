// Only the native environment is replaced. The compiler, class resolver,
// scoped-variable context, parsers, and hook are the installed Uniwind code.
export const Dimensions = {
  get: () => ({ width: 1024, height: 768 }),
  addEventListener: () => ({ remove() {} }),
};
export const Appearance = { getColorScheme: () => "light" };
export const I18nManager = { isRTL: false };
export const PixelRatio = { get: () => 1, getFontScale: () => 1 };
export const Platform = { OS: "android", isTV: false };
export const StyleSheet = { hairlineWidth: 1 };
