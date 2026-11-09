import { useState, useRef, useEffect } from 'react'
import { getProducts } from '../data/storage'

export default function ProductInput({ value, onChange, placeholder = 'Search product...' }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(value || '')
  const [PRODUCTS, setProducts] = useState([])
  const containerRef = useRef(null)

  // Catalog names come from the database (mirrors Shopify product titles)
  useEffect(() => {
    getProducts().then((list) => setProducts(list.map((p) => p.name))).catch(() => {})
  }, [])

  // Sync if parent resets value
  useEffect(() => { setQuery(value || '') }, [value])

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = query.trim()
    ? PRODUCTS.filter((p) => p.toLowerCase().includes(query.toLowerCase()))
    : PRODUCTS

  const select = (name) => {
    setQuery(name)
    onChange({ target: { value: name } })
    setOpen(false)
  }

  const handleChange = (e) => {
    setQuery(e.target.value)
    onChange(e)
    setOpen(true)
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        className="input w-full"
        type="text"
        value={query}
        placeholder={placeholder}
        onChange={handleChange}
        onFocus={() => setOpen(true)}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-line bg-surface py-1 shadow-xl">
          {filtered.map((name) => (
            <li
              key={name}
              onMouseDown={() => select(name)}
              className={`cursor-pointer px-3 py-2 text-sm hover:bg-plum-50 hover:text-accent ${
                name === query ? 'bg-plum-50 font-medium text-accent' : 'text-ink'
              }`}
            >
              {name}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
