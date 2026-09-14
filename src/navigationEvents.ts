export class NavigationEventOrder {
  private readonly latest = new Map<string, number>();

  /** Surface events and global retirement events can cross different JS queues. */
  accept({
    tabId,
    navigationSequence: sequence,
  }: {
    tabId: string;
    navigationSequence?: number;
  }): boolean {
    const previous = this.latest.get(tabId);
    if (sequence === undefined) return previous === undefined;
    if (
      !Number.isSafeInteger(sequence) ||
      sequence <= 0 ||
      (previous !== undefined && sequence <= previous)
    )
      return false;
    this.latest.set(tabId, sequence);
    return true;
  }

  retain(live: ReadonlySet<string>): void {
    for (const id of this.latest.keys())
      if (!live.has(id)) this.latest.delete(id);
  }
}
