/** Browser-storage namespace for every key this build reads or writes. */
export const storagePrefix = "parole";

export function storageKey(name: string) {
  return `${storagePrefix}:${name}`;
}
