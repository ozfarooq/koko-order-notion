import { useEffect, useState } from 'react'

// Light / dark preference, remembered per browser. The "Minimal Yet Warm" light theme is the default;
// the key changed with the redesign so everyone starts on it.
const KEY = 'koko-theme-v2'
const read = () => { try { return localStorage.getItem(KEY) } catch { return null } }

export function useTheme() {
  const [theme, setTheme] = useState(() => read() || 'light')

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    try { localStorage.setItem(KEY, theme) } catch { /* private mode: still works for this visit */ }
  }, [theme])

  return { theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) }
}
