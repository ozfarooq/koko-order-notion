// Product documents (docs/*.mdx) for the in-app "Product docs" menu. Served through the API with the
// owner-only `docs:read` permission, so their text is never part of the public JavaScript bundle.
import { readFile } from 'fs/promises'
import { HttpError } from './db.js'

export const DOCS = [
  { slug: 'product-requirements', file: 'product-requirements.mdx', label: 'Product requirements' },
  { slug: 'technical-requirements', file: 'technical-requirements.mdx', label: 'Technical requirements' },
  { slug: 'app-flow', file: 'app-flow.mdx', label: 'App flow' },
  { slug: 'design-brief', file: 'design-brief.mdx', label: 'Design & brand' },
  { slug: 'database-schema', file: 'database-schema.mdx', label: 'Database schema' },
  { slug: 'implementation-plan', file: 'implementation-plan.mdx', label: 'Implementation plan' },
]

// '---\ntitle: "…"\ndescription: "…"\n---' at the top of each file
function frontmatter(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)
  if (!m) return { meta: {}, body: src }
  const meta = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*"?(.*?)"?\s*$/)
    if (kv) meta[kv[1]] = kv[2]
  }
  return { meta, body: src.slice(m[0].length) }
}

export const listDocs = () => DOCS.map(({ slug, label }) => ({ slug, label }))

export async function getDoc(slug) {
  const doc = DOCS.find((d) => d.slug === slug)
  if (!doc) throw new HttpError(404, 'Document not found')
  const src = await readFile(new URL(`../docs/${doc.file}`, import.meta.url), 'utf8')
  const { meta, body } = frontmatter(src)
  return { slug: doc.slug, label: doc.label, file: doc.file, title: meta.title || doc.label, description: meta.description || '', content: body }
}
