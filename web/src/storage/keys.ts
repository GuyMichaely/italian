/** Browser-storage namespace for every key this build reads or writes. */
export const storagePrefix = "italian";

export function storageKey(name: string) {
  return `${storagePrefix}:${name}`;
}
