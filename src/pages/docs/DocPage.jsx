import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import * as runtime from 'react/jsx-runtime'
import { BookMarked, Download, ChevronLeft, ChevronRight } from 'lucide-react'
import { api } from '../../data/storage'
import { PageHeader, SkeletonRows, ErrorBanner } from '../../ui/kit'

// The product documents in docs/*.mdx, rendered in the app for owners. The MDX is fetched from the
// API (owner-only) and compiled in the browser, then drawn with the CRM's own type and table styles.
const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }
const slugify = (children) => String(Array.isArray(children) ? children.join('') : children ?? '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
const text = (node) => (typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : '')

function components(docSlugs) {
  const H = (Tag, cls) => ({ children }) => <Tag id={slugify(text(children))} className={`scroll-mt-24 ${cls}`}>{children}</Tag>
  return {
    h1: () => null,                                       // the page header shows the title
    h2: H('h2', 'mt-10 border-b border-line pb-2 text-xl font-semibold text-ink first:mt-0'),
    h3: H('h3', 'mt-7 text-base font-semibold text-ink'),
    h4: H('h4', 'mt-5 font-label text-[11px] font-semibold uppercase tracking-[0.18em] text-muted'),
    p: (p) => <p className="mt-3 text-sm leading-relaxed text-ink-soft" {...p} />,
    ul: (p) => <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink-soft marker:text-gold-500" {...p} />,
    ol: (p) => <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-ink-soft marker:text-muted" {...p} />,
    li: (p) => <li className="pl-1" {...p} />,
    strong: (p) => <strong className="font-semibold text-ink" {...p} />,
    em: (p) => <em className="text-ink" {...p} />,
    hr: () => <hr className="my-8 border-line" />,
    blockquote: (p) => <blockquote className="mt-4 border-l-2 border-gold-400 bg-subtle/60 py-1 pl-4 pr-3 italic [&>p]:mt-2 [&>p:first-child]:mt-1" {...p} />,
    table: (p) => <div className="card mt-4 overflow-x-auto"><table className="w-full min-w-[520px] text-sm" {...p} /></div>,
    thead: (p) => <thead {...p} />,
    th: ({ style, ...p }) => <th className="th whitespace-nowrap" style={style} {...p} />,
    td: ({ style, ...p }) => <td className="border-t border-line px-3 py-2 align-top text-ink-soft" style={style} {...p} />,
    pre: (p) => <pre className="mt-4 overflow-x-auto rounded-xl border border-line bg-subtle/70 p-4 text-[12px] leading-snug text-ink" style={MONO} {...p} />,
    code: ({ className, ...p }) => className
      ? <code className={className} style={MONO} {...p} />           // inside a code block
      : <code className="rounded bg-subtle2 px-1 py-0.5 text-[12.5px] text-ink" style={MONO} {...p} />,
    a: ({ href = '', children }) => {
      // Links between the documents open in the app; other repo files are shown as plain text
      const m = href.match(/^\.\/([\w-]+)\.mdx?(#.*)?$/)
      if (m) return docSlugs.includes(m[1])
        ? <Link to={`/docs/${m[1]}${m[2] || ''}`} className="font-medium text-accent underline decoration-plum-200 underline-offset-2 hover:decoration-current">{children}</Link>
        : <span className="font-medium text-ink" title={`docs/${m[1]} (in the repository)`}>{children}</span>
      if (href.startsWith('#')) return <a href={href} className="font-medium text-accent hover:underline">{children}</a>
      return <a href={href} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">{children}</a>
    },
    input: (p) => <input {...p} disabled className="mr-1.5 accent-[#7B2D45]" />,
  }
}

export default function DocPage() {
  const { slug } = useParams()
  const [list, setList] = useState([])
  const [doc, setDoc] = useState(null)
  const [Content, setContent] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => { api('/docs').then(setList).catch(() => {}) }, [])
  useEffect(() => {
    let alive = true
    setDoc(null); setContent(null); setError(null)
    ;(async () => {
      try {
        const d = await api(`/docs/${slug}`)
        const [{ evaluate }, { default: remarkGfm }] = await Promise.all([import('@mdx-js/mdx'), import('remark-gfm')])
        const mod = await evaluate(d.content, { ...runtime, remarkPlugins: [remarkGfm] })
        if (alive) { setDoc(d); setContent(() => mod.default); window.scrollTo(0, 0) }
      } catch (err) { if (alive) setError(err.message) }
    })()
    return () => { alive = false }
  }, [slug])

  // Contents: the document's ## headings
  const toc = useMemo(() => (doc ? [...doc.content.matchAll(/^## (.+)$/gm)].map((m) => ({ title: m[1].replace(/[`*]/g, ''), id: slugify(m[1].replace(/[`*]/g, '')) })) : []), [doc])
  const slugs = list.map((d) => d.slug)
  const i = slugs.indexOf(slug)
  const prev = list[i - 1], next = list[i + 1]
  const download = () => {
    const url = URL.createObjectURL(new Blob([`---\ntitle: "${doc.title}"\ndescription: "${doc.description}"\n---\n\n${doc.content}`], { type: 'text/markdown' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: doc.file }); a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader eyebrow="Product docs" icon={BookMarked} title={doc?.label || list.find((d) => d.slug === slug)?.label || 'Document'}
        subtitle={doc ? `${doc.description} · docs/${doc.file}` : ''}
        actions={doc && <button className="btn-secondary whitespace-nowrap" onClick={download}><Download size={15} />Download .mdx</button>} />
      <ErrorBanner>{error}</ErrorBanner>
      {!Content ? !error && <SkeletonRows rows={10} /> : (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_220px]">
          <article className="card min-w-0 p-5 sm:p-8"><Content components={components(slugs)} /></article>
          <aside className="hidden lg:block">
            <nav className="sticky top-24 space-y-1 text-sm">
              <p className="section-title mb-2">Contents</p>
              {toc.map((t) => <a key={t.id} href={`#${t.id}`} className="block truncate rounded-lg px-2 py-1 text-muted hover:bg-subtle hover:text-ink">{t.title}</a>)}
            </nav>
          </aside>
        </div>
      )}
      {Content && (
        <div className="flex justify-between gap-3">
          {prev ? <Link to={`/docs/${prev.slug}`} className="btn-secondary"><ChevronLeft size={15} />{prev.label}</Link> : <span />}
          {next && <Link to={`/docs/${next.slug}`} className="btn-secondary">{next.label}<ChevronRight size={15} /></Link>}
        </div>
      )}
    </div>
  )
}
