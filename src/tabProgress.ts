export interface TabLoadState {
  loading: boolean;
  progress: number;
}

export interface TabProgressEvent extends TabLoadState {
  tabId: string;
}

type SubscribeToProgress = (
  listener: (event: TabProgressEvent) => void
) => () => void;

/** Page progress is transient view state: notify only the pane showing
 *  that tab, and keep one native subscription for all visible panes. */
export class TabProgressStore {
  private states = new Map<string, TabLoadState>();
  private listeners = new Map<string, Set<() => void>>();
  private unsubscribe: (() => void) | undefined;

  constructor(private subscribeToProgress: SubscribeToProgress) {}

  getSnapshot = (tabId: string): TabLoadState | undefined =>
    this.states.get(tabId);

  subscribe(tabId: string, listener: () => void): () => void {
    const listeners = this.listeners.get(tabId) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(tabId, listeners);
    this.unsubscribe ??= this.subscribeToProgress(this.update);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(tabId);
      if (!this.listeners.size) {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
      }
    };
  }

  private update = ({ tabId, loading, progress }: TabProgressEvent) => {
    const previous = this.states.get(tabId);
    if (previous?.loading === loading && previous.progress === progress) return;
    this.states.delete(tabId);
    this.states.set(tabId, { loading, progress });
    // Retain recent background loads for tab switches, never accumulate
    // every closed tab throughout a long browser session.
    for (const id of this.states.keys()) {
      if (this.states.size <= 128) break;
      if (!this.listeners.has(id)) this.states.delete(id);
    }
    this.listeners.get(tabId)?.forEach((listener) => listener());
  };
}
