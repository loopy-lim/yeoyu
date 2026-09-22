export interface FrameScheduler {
  request(callback: () => void): number;
  cancel(handle: number): void;
}

/** Latest-value delivery at most once per frame, with synchronous release/cancel. */
export class FrameCoalescer<T> {
  private handle: number | null = null;
  private pending: { value: T } | null = null;
  private generation = 0;

  constructor(
    private consume: (value: T) => void,
    private scheduler: FrameScheduler = {
      request: (callback) => requestAnimationFrame(callback),
      cancel: (handle) => cancelAnimationFrame(handle),
    }
  ) {}
  /** Refresh from useLayoutEffect when the consumer reads current rendered state. */
  setConsumer(consume: (value: T) => void): void {
    this.consume = consume;
  }

  push(value: T): void {
    this.pending = { value };
    if (this.handle !== null) return;
    const generation = ++this.generation;
    this.handle = this.scheduler.request(() => {
      if (generation !== this.generation) return;
      this.handle = null;
      const pending = this.pending;
      this.pending = null;
      if (pending) this.consume(pending.value);
    });
  }

  /** A release can supply coordinates newer than the last move event. */
  flush(...finalValue: [] | [T]): void {
    const pending = finalValue.length ? { value: finalValue[0] } : this.pending;
    this.cancel();
    if (pending) this.consume(pending.value);
  }

  /** Ends the current owner; even a late cancelled callback cannot touch a new one. */
  cancel(): void {
    const handle = this.handle;
    this.generation++;
    this.handle = null;
    this.pending = null;
    if (handle !== null) this.scheduler.cancel(handle);
  }
}
