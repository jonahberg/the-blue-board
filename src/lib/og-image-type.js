// ═══ og:image:type ═══
// The share-card MIME type has to match the file the server returns. v1.8.0 hard-coded
// image/png on every page while almost every page ships a /og/*.jpg served as image/jpeg.

/**
 * @param {string} url  absolute or root-relative og:image URL.
 * @returns {'image/jpeg'|'image/webp'|'image/gif'|'image/png'}
 */
export function ogImageType(url) {
  const path = String(url).split(/[?#]/)[0].toLowerCase();
  if (/\.jpe?g$/.test(path)) return 'image/jpeg';
  if (path.endsWith('.webp')) return 'image/webp';
  if (path.endsWith('.gif')) return 'image/gif';
  return 'image/png';
}
