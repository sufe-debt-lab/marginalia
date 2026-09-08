export type RunLease = { release(): void };

export class SessionRunLeases {
  private readonly active = new Set<string>();

  tryAcquire(sessionId: string): RunLease | null {
    if (this.active.has(sessionId)) return null;
    this.active.add(sessionId);

    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.active.delete(sessionId);
      }
    };
  }

  isBusy(sessionId: string): boolean {
    return this.active.has(sessionId);
  }
}
