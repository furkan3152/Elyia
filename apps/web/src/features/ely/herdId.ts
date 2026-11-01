/** A Herd number from an address (stable, 1..9999): the account's portrait. */
export function herdIdOf(address: string | null): number {
  if (!address) return 777;
  let hash = 0;
  for (let index = 2; index < address.length; index += 1) hash = (hash * 31 + address.charCodeAt(index)) >>> 0;
  return (hash % 9999) + 1;
}
