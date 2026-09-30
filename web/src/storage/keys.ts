/**
 * Browser-storage namespace for every key this build reads or writes.
 *
 * This branch changes the stored noun and grammar format, while the published /prototype/ build
 * shares an origin (and so localStorage) with the production app. The prototype therefore keeps
 * its data under its own prefix so the production app's inventory is never read or rewritten.
 * Load data into it by restoring a backup converted with scripts/migrate-noun-declensions.mjs.
 * Switch this back to "parole" when this branch replaces production.
 */
export const storagePrefix = "parole-next";

export function storageKey(name: string) {
  return `${storagePrefix}:${name}`;
}
