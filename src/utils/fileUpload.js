// Reads a chosen file as { name, mime, data: base64 } for upload. Large photos (phone receipts) are
// shrunk first, longest side 2000 px as JPEG, so they stay well under the 2.5 MB upload limit.
const SHRINK_OVER = 1_200_000
const MAX_SIDE = 2000

const base64Of = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(String(r.result).split(',')[1])
  r.onerror = reject
  r.readAsDataURL(blob)
})

async function shrink(file) {
  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) return null
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
}

export async function readUpload(file) {
  let blob = file, mime = file.type || 'application/octet-stream', name = file.name
  if (/^image\/(jpeg|png|webp|heic|heif)$/.test(mime) && file.size > SHRINK_OVER) {
    const small = await shrink(file)
    if (small && small.size < file.size) { blob = small; mime = 'image/jpeg'; name = name.replace(/\.\w+$/, '') + '.jpg' }
  }
  return { name, mime, data: await base64Of(blob) }
}

// Opens { name, mime, data } (from the API) in a new tab
export function openFileData(f, tab = null) {
  const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: f.mime }))
  if (tab) tab.location.href = url; else window.open(url, '_blank') || (window.location.href = url)
}
