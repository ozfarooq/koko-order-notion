// Files (receipts, payment proofs, statements, opening balance workings). On Vercel Blob when a Blob
// store is connected (fin_files.blob_url), otherwise in the database (fin_file_blobs). This module is the
// only place that knows, so a later move (Google Drive) changes this file and a copy script, not the
// screens (spec v1.6, C3).
import { neon } from '@neondatabase/serverless'
import { createHash } from 'crypto'
import { HttpError, blank } from '../db.js'
import { blobOn, putBlob, readBlob } from '../blob.js'

let _sql
const db = () => (_sql ??= neon(process.env.DATABASE_URL))
const sql = (...args) => db()(...args)

export const FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
const MAX = 2621440   // 2.5 MB: the request limit on Vercel leaves room for base64

// { name, mime, data: base64 } -> file row. The same file (by SHA-256) is stored once and reused.
export async function saveFile(b, user, folder = null) {
  if (!FILE_TYPES.includes(b.mime)) throw new HttpError(400, 'Attach a photo (JPG, PNG, WebP), a PDF, a CSV or an Excel file')
  const bytes = Buffer.from(String(b.data || ''), 'base64')
  if (!bytes.length) throw new HttpError(400, 'The file is empty')
  if (bytes.length > MAX) throw new HttpError(400, 'Files can be up to 2.5 MB. Try a smaller photo or PDF.')
  const sha = createHash('sha256').update(bytes).digest('hex')
  const [found] = await sql`SELECT id, name, mime, size FROM fin_files WHERE sha256 = ${sha}`
  if (found) return { ...found, reused: true }
  const name = (blank(b.name) || 'file').slice(0, 160)
  if (blobOn()) {
    const url = await putBlob(folder || 'files', name, bytes, b.mime)
    const [row] = await sql`INSERT INTO fin_files (name, mime, size, sha256, folder, blob_url, created_by)
      VALUES (${name}, ${b.mime}, ${bytes.length}, ${sha}, ${folder}, ${url}, ${user?.id ?? null}) RETURNING id, name, mime, size`
    return row
  }
  const [row] = await sql`
    WITH f AS (
      INSERT INTO fin_files (name, mime, size, sha256, folder, created_by)
      VALUES (${name}, ${b.mime}, ${bytes.length}, ${sha}, ${folder}, ${user?.id ?? null})
      RETURNING id, name, mime, size
    ), blob AS (
      INSERT INTO fin_file_blobs (file_id, data) SELECT id, ${'\\x' + bytes.toString('hex')}::bytea FROM f
    )
    SELECT * FROM f`
  return row
}

export async function getFile(id) {
  const [f] = await sql`SELECT f.name, f.mime, f.blob_url, encode(b.data, 'base64') AS data FROM fin_files f LEFT JOIN fin_file_blobs b ON b.file_id = f.id WHERE f.id = ${Number(id)}`
  if (!f || (!f.blob_url && !f.data)) throw new HttpError(404, 'File not found')
  if (f.blob_url) return { name: f.name, mime: f.mime, data: (await readBlob(f.blob_url)).toString('base64') }
  return { name: f.name, mime: f.mime, data: f.data.replace(/\s/g, '') }
}

export async function attachToEntry(entryId, fileId) {
  const [e] = await sql`SELECT id FROM fin_entries WHERE id = ${Number(entryId)}`
  if (!e) throw new HttpError(404, 'Entry not found')
  await sql`INSERT INTO fin_entry_files (entry_id, file_id) VALUES (${e.id}, ${Number(fileId)}) ON CONFLICT DO NOTHING`
}
