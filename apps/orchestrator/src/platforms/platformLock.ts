const tails = new Map<string, Promise<void>>();

/** Serializes outbound work per platform while allowing different platforms in parallel. */
export async function withPlatformLock<T>(
  platformId: string,
  action: () => Promise<T>
): Promise<T> {
  const previous = tails.get(platformId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  tails.set(platformId, tail);

  await previous;
  try {
    return await action();
  } finally {
    release();
    if (tails.get(platformId) === tail) tails.delete(platformId);
  }
}
