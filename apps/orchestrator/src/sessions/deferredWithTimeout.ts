/**
 * A promise someone else settles, with a deadline.
 *
 * Approval requests park a promise until a human answers. Without a deadline an
 * unattended run can sit blocked for days, holding a concurrency slot the whole
 * time. This gives the wait an expiry and a default outcome, while keeping the
 * settle path idempotent — a timeout that fires as the user clicks must not
 * resolve the same promise twice.
 */
export interface DeferredWithTimeout<T> {
  promise: Promise<T>;
  /** Resolve early. Returns false if it had already been settled. */
  settle: (value: T) => boolean;
  /** Drop the timer without resolving — for when the whole session is going away. */
  cancel: () => void;
  isSettled: () => boolean;
  /** When the timeout will fire, or null if there is no deadline. */
  expiresAt: Date | null;
}

export function createDeferredWithTimeout<T>(
  timeoutMs: number,
  onTimeout: () => T
): DeferredWithTimeout<T> {
  let settled = false;
  let timer: NodeJS.Timeout | null = null;
  let resolveFn!: (value: T) => void;

  const promise = new Promise<T>((resolve) => {
    resolveFn = resolve;
  });

  const finish = (value: T): boolean => {
    if (settled) return false;
    settled = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    resolveFn(value);
    return true;
  };

  // A non-positive timeout means "wait indefinitely", which is a legitimate
  // choice for someone who would rather a run stall than be auto-denied.
  const hasDeadline = Number.isFinite(timeoutMs) && timeoutMs > 0;

  if (hasDeadline) {
    timer = setTimeout(() => {
      finish(onTimeout());
    }, timeoutMs);
    // Don't keep the process alive purely for a pending approval.
    timer.unref?.();
  }

  return {
    promise,
    settle: finish,
    cancel: () => {
      settled = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
    isSettled: () => settled,
    expiresAt: hasDeadline ? new Date(Date.now() + timeoutMs) : null,
  };
}
