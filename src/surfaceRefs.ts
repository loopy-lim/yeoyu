/** A retiring view must not unregister a newer owner of the same session. */
export function registerSurfaceRef<T>(
  refs: Map<string, T>,
  id: string,
  surface: T
) {
  refs.set(id, surface);
  return () => {
    if (refs.get(id) === surface) refs.delete(id);
  };
}
