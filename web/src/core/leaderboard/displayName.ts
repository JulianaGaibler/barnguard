/**
 * A stored name as the screens show it. Names are lowercase and the screens set
 * them in capitals. `ß` has no single capital letter in `toUpperCase`, which
 * returns `SS`, so it is mapped to `ẞ` first to keep the length of the name.
 */
export function displayName(name: string): string {
  return name.replaceAll('ß', 'ẞ').toUpperCase()
}
