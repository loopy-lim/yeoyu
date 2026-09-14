/** Android may follow a pointer event with a touch responder release. */
export class ContextPressGuard {
  private secondary = false;

  pointerDown(pointerType: string, button: number): boolean {
    this.secondary = pointerType === "mouse" && button === 2;
    return this.secondary;
  }

  allowPress(): boolean {
    return !this.secondary;
  }

  reset(): void {
    this.secondary = false;
  }
}
