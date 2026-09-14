interface MotionPreferenceSource {
  read: () => Promise<boolean>;
  subscribe: (listener: (enabled: boolean) => void) => () => void;
}

/** Share one OS subscription and prefer fresh events over a pending query. */
export class ReducedMotionStore {
  // Do not animate before the OS preference is known.
  private enabled = true;
  private listeners = new Set<() => void>();
  private unsubscribe: (() => void) | undefined;
  private generation = 0;

  constructor(private source: MotionPreferenceSource) {}

  getSnapshot = () => this.enabled;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      const generation = ++this.generation;
      let receivedEvent = false;
      this.unsubscribe = this.source.subscribe((enabled) => {
        if (generation !== this.generation) return;
        receivedEvent = true;
        this.update(enabled);
      });
      this.source.read().then(
        (enabled) => {
          if (generation === this.generation && !receivedEvent)
            this.update(enabled);
        },
        () => {} // Keep the safe default; the live subscription can still recover.
      );
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        ++this.generation;
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        this.enabled = true;
      }
    };
  };

  private update(enabled: boolean) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.listeners.forEach((listener) => listener());
  }
}
