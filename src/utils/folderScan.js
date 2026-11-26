// Picking up receipts from a folder on this computer. Chrome and Edge can keep the folder (the browser
// asks again for permission when it is next scanned); other browsers pick the folder each time.
// Each file is known by the sha256 of its bytes, so a rescan only sends what is new.
const READABLE = /\.(jpe?g|png|webp|gif|pdf)$/i
const PHONE_PHOTO = /\.(heic|heif)$/i

export const canKeepFolder = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window

// ── The remembered folder (IndexedDB holds the browser's handle to it) ──
const DB = 'koko-folders', STORE = 'handles', KEY = 'receipts'
function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE)
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}
async function idbDo(mode, fn) {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const req = fn(tx.objectStore(STORE))
    tx.oncomplete = () => resolve(req?.result)
    tx.onerror = () => reject(tx.error)
  })
}
export async function savedFolder() {
  try { return (await idbDo('readonly', (s) => s.get(KEY))) || null } catch { return null }
}
export async function pickFolder() {
  const handle = await window.showDirectoryPicker({ id: 'koko-receipts', mode: 'read' })
  try { await idbDo('readwrite', (s) => s.put(handle, KEY)) } catch { /* kept for this visit only */ }
  return handle
}
export async function forgetFolder() {
  try { await idbDo('readwrite', (s) => s.delete(KEY)) } catch { /* nothing kept */ }
}
// Asks again for read access to a remembered folder (needs a click)
export async function allowFolder(handle) {
  if ((await handle.queryPermission({ mode: 'read' })) === 'granted') return true
  return (await handle.requestPermission({ mode: 'read' })) === 'granted'
}

// Every file under the folder: [{ file, path }]
export async function filesIn(handle, prefix = '') {
  const out = []
  for await (const [name, h] of handle.entries()) {
    if (name.startsWith('.')) continue
    if (h.kind === 'directory') out.push(...(await filesIn(h, `${prefix}${name}/`)))
    else out.push({ file: await h.getFile(), path: `${prefix}${name}` })
  }
  return out
}
// From <input webkitdirectory>: the same shape
export const filesFromInput = (list) => [...list].map((file) => ({ file, path: file.webkitRelativePath || file.name }))

// Splits what can be read from what can't (iPhone HEIC photos need exporting as JPEG first)
export function sortOut(entries) {
  return {
    readable: entries.filter((x) => READABLE.test(x.path)),
    phonePhotos: entries.filter((x) => PHONE_PHOTO.test(x.path)).length,
    other: entries.filter((x) => !READABLE.test(x.path) && !PHONE_PHOTO.test(x.path)).length,
  }
}

export async function sha256(file) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
