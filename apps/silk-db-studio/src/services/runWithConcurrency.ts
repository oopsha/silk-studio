export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  async function next(): Promise<void> {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      await worker(current);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => next()),
  );
}
