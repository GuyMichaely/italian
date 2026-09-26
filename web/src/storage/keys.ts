/**
 * Browser-storage namespace for every key this build reads or writes.
 *
 * This branch changes the stored noun and grammar format, while the published /prototype/ build
 * shares an origin (and so localStorage) with the production app. The prototype therefore keeps
 * its data under its own prefix so the production app's inventory is never rewritten.
 * Switch this back to "parola" when this branch replaces production, after converting existing
 * inventories with scripts/migrate-noun-declensions.mjs.
 */
export const storagePrefix = "parola-next";

/** The production app's namespace, read only to offer a one-time copy into the prototype. */
export const productionStoragePrefix = "parola";

export function storageKey(name: string) {
  return `${storagePrefix}:${name}`;
}
