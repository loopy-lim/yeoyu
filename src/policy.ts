/** Only background sessions may own a mini surface; a session never has two displays. */
export function miniPlayerTabs(
  playing: string[],
  visible: Set<string>,
  dismissed: Set<string>
): string[] {
  return [...new Set(playing)].filter(
    (id) => !visible.has(id) && !dismissed.has(id)
  );
}
/** Native callbacks and UI mutations share ordering, including rejection recovery. */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
