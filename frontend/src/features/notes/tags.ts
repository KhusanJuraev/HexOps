// Same rule as the backend (notes/schemas.py): trim, NFC, lower-case; letters of
// any script, digits, "-" and "_"; starts with a letter or digit; up to 32.
const TAG = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,31}$/u

export function normalizeTag(raw: string): string | null {
  const tag = raw.trim().normalize('NFC').toLowerCase()
  return TAG.test(tag) ? tag : null
}
