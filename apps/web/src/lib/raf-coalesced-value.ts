/**
 * Coalesces rapid value updates into at most one paint per animation frame.
 * While streaming, bursty token arrivals share a single flush; callers should
 * call {@link RafValueCoalescer.sync} when streaming ends so the final value
 * paints immediately.
 *
 * When `requestAnimationFrame` is unavailable (e.g. Bun tests), falls back to
 * a microtask so same-turn bursts still coalesce.
 */
export class RafValueCoalescer<T> {
  private pending: T;
  private rafId: number | null = null;
  private scheduled = false;
  private generation = 0;

  constructor(
    initial: T,
    private readonly onFlush: (value: T) => void,
  ) {
    this.pending = initial;
  }

  /** Queue `value` for the next animation frame (coalesced). */
  set(value: T): void {
    this.pending = value;
    if (this.scheduled) {
      return;
    }

    this.scheduled = true;
    const generation = this.generation;

    const run = () => {
      if (generation !== this.generation) {
        return;
      }
      this.scheduled = false;
      this.rafId = null;
      this.onFlush(this.pending);
    };

    if (typeof requestAnimationFrame === "function") {
      this.rafId = requestAnimationFrame(run);
      return;
    }

    queueMicrotask(run);
  }

  /** Cancel any pending frame and publish `value` immediately. */
  sync(value: T): void {
    this.cancel();
    this.pending = value;
    this.onFlush(value);
  }

  cancel(): void {
    this.generation += 1;
    this.scheduled = false;
    if (this.rafId != null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.rafId);
    }
    this.rafId = null;
  }
}
