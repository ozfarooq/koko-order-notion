import { useState, useRef, useEffect } from 'react'
import { PRODUCTS } from '../data/products'

export default function ProductInput({ value, onChange, placeholder = 'Search product...' }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(value || '')
  const containerRef = useRef(null)

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
        <ul className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-xl">
          {filtered.map((name) => (
            <li
              key={name}
              onMouseDown={() => select(name)}
              className={`cursor-pointer px-3 py-2 text-sm hover:bg-brand-50 hover:text-brand-700 ${
                name === query ? 'bg-brand-50 font-medium text-brand-700' : 'text-gray-800'
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
