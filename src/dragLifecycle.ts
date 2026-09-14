/** Gesture truth stays synchronous while React renders its visual preview. */
export class DragLifecycle<T> {
  private sequence = 0;
  private current: { id: number; value: T; released: boolean } | null = null;

  begin(value: T): void {
    this.current = { id: ++this.sequence, value, released: false };
  }

  release(): { id: number; value: T } | null {
    const current = this.current;
    if (!current || current.released) return null;
    current.released = true;
    return { id: current.id, value: current.value };
  }

  finish(id: number): boolean {
    if (this.current?.id !== id || !this.current.released) return false;
    this.current = null;
    return true;
  }

  cancel(): void {
    this.current = null;
  }
}
