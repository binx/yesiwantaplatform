/**
 * Join class names, dropping falsy entries.
 *
 * CSS Module lookups are `string | undefined` under `noUncheckedIndexedAccess`,
 * which antd's props reject under `exactOptionalPropertyTypes`. Both flags earn
 * their keep elsewhere, so narrow here instead of relaxing them.
 */
export function cx(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(" ");
}
