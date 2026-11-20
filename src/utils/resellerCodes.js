// The reseller's own product code plus a size suffix, e.g. KOATLR-010-S (as Fashion Collage asked)
export const SIZE_SUFFIX = { 'X-Small': 'XS', Small: 'S', Medium: 'M', Large: 'L', 'X-Large': 'XL', Custom: 'C' }
export const sizeCode = (code, size) => (code ? `${code}-${SIZE_SUFFIX[size] || String(size || '').toUpperCase()}` : '')
