/**
 * Overrides of a request in a test. The settings of the repository make an optional item unable to be
 * `undefined` (`exactOptionalPropertyTypes`), so a test that wants an item to be absent says
 * `{ item: undefined }`, and the item is taken out of the request instead of being set to `undefined`.
 */
export type Override<T> = { readonly [K in keyof T]?: T[K] | undefined };

export function overridden<T extends object>(base: T, over: Override<T>): T {
  const result: Record<string, unknown> = Object.fromEntries(Object.entries(base));
  for (const [key, value] of Object.entries(over)) {
    if (value === undefined) {
      delete result[key];
    } else {
      result[key] = value;
    }
  }
  return result as T;
}
