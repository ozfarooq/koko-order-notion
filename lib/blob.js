// File storage on Vercel Blob (receipts, payment proofs, statements). Switched on by the
// BLOB_READ_WRITE_TOKEN that Vercel adds when a Blob store is connected to the project; without it
// (tests, local work) files stay in the database as before. Blob URLs are unguessable but public, so
// they never reach the browser: files are always read back through the API, behind the login.
import { put, del } from '@vercel/blob'
import { HttpError } from './db.js'

export const blobOn = () => !!process.env.BLOB_READ_WRITE_TOKEN

const safe = (s) => String(s || 'file').normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').slice(0, 80)

// folder/yyyy-mm/name-<random>.ext -> the blob URL
export async function putBlob(folder, name, bytes, mime) {
  const month = new Date().toISOString().slice(0, 7)
  const r = await put(`${safe(folder)}/${month}/${safe(name)}`, bytes, { access: 'public', contentType: mime, addRandomSuffix: true })
  return r.url
}

export async function readBlob(url) {
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) throw new HttpError(502, `The stored file couldn't be read (${r.status})`)
  return Buffer.from(await r.arrayBuffer())
}

export async function deleteBlob(url) {
  if (url && blobOn()) await del(url).catch(() => {})
}
