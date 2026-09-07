export async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  task: (item: T, index: number) => PromiseLike<R>,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new RangeError("Invalid concurrency");
  const result = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  let failure: unknown;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        result[index] = await task(items[index], index);
      } catch (error) {
        if (!failed) { failed = true; failure = error; }
      }
    }
  }));
  if (failed) throw failure;
  return result;
}
