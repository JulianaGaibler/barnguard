/**
 * The accented forms offered when a letter key is held. Names are lowercase end
 * to end, so the table has no capitals.
 *
 * The locale decides the order. Its own letters come first (`ä ö ü ß` for
 * German), then the rest in the table's order. Adding a locale is one more
 * entry in `LOCALE_PRIORITY`.
 */

const VARIANTS: Readonly<Record<string, string>> = {
  a: 'äàáâåãæąāă',
  c: 'çćčĉċ',
  d: 'ďđð',
  e: 'éèêëęěēė',
  g: 'ğĝġģ',
  h: 'ĥħ',
  i: 'íìîïīįı',
  j: 'ĵ',
  k: 'ķ',
  l: 'łĺľļ',
  n: 'ñńňņ',
  o: 'öóòôõøőōœ',
  r: 'řŕŗ',
  s: 'ßśšşșŝ',
  t: 'ťţțþ',
  u: 'üúùûůűūų',
  w: 'ŵ',
  y: 'ýÿŷ',
  z: 'žźż',
}

const LOCALE_PRIORITY: Readonly<Record<string, string>> = {
  cs: 'áčďéěíňóřšťúůýž',
  da: 'æøå',
  de: 'äöüß',
  es: 'áéíóúñü',
  fr: 'éèêàçùûôîëïœ',
  hu: 'áéíóöőúüű',
  it: 'àèéìòù',
  nb: 'æøå',
  nl: 'ëï',
  pl: 'ąćęłńóśźż',
  pt: 'ãáâàçéêíõóôú',
  ro: 'ăâîșț',
  sv: 'åäö',
  tr: 'çğıöşü',
}

/** Every character that has a base letter, for accepting physical keys. */
export const ALL_VARIANT_CHARS: ReadonlySet<string> = new Set(
  Object.values(VARIANTS).flatMap((chars) => Array.from(chars)),
)

/**
 * The accents for `base` with the locale's own letters first, or an empty list
 * when the letter has none. `locale` may carry a region (`de-AT`).
 */
export function variantsFor(base: string, locale: string): string[] {
  const all = Array.from(VARIANTS[base] ?? '')
  const preferred = Array.from(LOCALE_PRIORITY[locale.split('-')[0]] ?? '')
  const first = preferred.filter((ch) => all.includes(ch))
  return [...first, ...all.filter((ch) => !first.includes(ch))]
}
