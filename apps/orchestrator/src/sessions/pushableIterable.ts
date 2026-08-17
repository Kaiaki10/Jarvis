export interface Pushable<T> extends AsyncIterable<T> {
  push(value: T): void;
  close(): void;
}

export function createPushable<T>(): Pushable<T> {
  const queue: T[] = [];
  const waiters: Array<(result: IteratorResult<T>) => void> = [];
  let closed = false;

  return {
    push(value: T) {
      if (closed) return;
      const waiter = waiters.shift();
      if (waiter) {
        waiter({ value, done: false });
      } else {
        queue.push(value);
      }
    },
    close() {
      closed = true;
      while (waiters.length) {
        const waiter = waiters.shift()!;
        waiter({ value: undefined as unknown as T, done: true });
      }
    },
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<T>> {
          if (queue.length) {
            return Promise.resolve({ value: queue.shift() as T, done: false });
          }
          if (closed) {
            return Promise.resolve({ value: undefined as unknown as T, done: true });
          }
          return new Promise((resolve) => waiters.push(resolve));
        },
      };
    },
  };
}
