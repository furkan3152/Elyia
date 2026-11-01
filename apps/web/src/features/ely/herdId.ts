/** A Herd number from an address (stable, 1..3333): the account's portrait until it holds a goat. */
export function herdIdOf(address: string | null): number {
  if (!address) return 777;
  let hash = 0;
  for (let index = 2; index < address.length; index += 1) hash = (hash * 31 + address.charCodeAt(index)) >>> 0;
  return (hash % 3333) + 1;
}
