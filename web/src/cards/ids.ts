/**
 * A new card's id: a random whole number, final from the moment the card is made. Cards added in
 * two windows at once, or by anything else that writes the inventory, can't end up with the same
 * id. Ids from 2^32 up never meet the small sequential ids older cards keep.
 */
export function newCardId(): number {
  const [high, low] = crypto.getRandomValues(new Uint32Array(2));
  // 53 bits, the most a number holds exactly.
  return Math.max(1, high & 0x1fffff) * 2 ** 32 + low;
}
