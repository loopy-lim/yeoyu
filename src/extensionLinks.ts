/** Parse the raw path before URL normalization can erase dot segments or slashes.
 * Native repeats the same validation; no user-provided address is fetched directly. */
export function mozillaExtensionSource(input: string): string {
  const source = input.trim();
  const invalid = () =>
    new Error(
      "Paste a Mozilla Add-ons extension page link (https://addons.mozilla.org/…/addon/…). Direct files and other stores are not supported."
    );
  if (source.length > 2048 || /[\s\u0000-\u001f\u007f\\]/u.test(source))
    throw invalid();
  const match =
    /^https:\/\/addons\.mozilla\.org(?::443)?\/(?:[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*\/)?(?:firefox|android)\/addon\/([^/?#]+)\/?(?:[?#].*)?$/.exec(
      source
    );
  if (!match) throw invalid();
  let slug: string;
  try {
    slug = decodeURIComponent(match[1]!);
  } catch {
    throw invalid();
  }
  if (!/^[\p{L}\p{N}_~-]{1,200}$/u.test(slug) || /^\p{N}+$/u.test(slug))
    throw invalid();
  return `https://addons.mozilla.org/firefox/addon/${encodeURIComponent(
    slug
  )}/`;
}
