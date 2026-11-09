import { useEffect, useState } from 'react'

// Light / dark preference, remembered per browser (falls back to the device setting)
const KEY = 'koko-theme'
const read = () => { try { return localStorage.getItem(KEY) } catch { return null } }
const systemDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches

export function useTheme() {
  const [theme, setTheme] = useState(() => read() || (systemDark() ? 'dark' : 'light'))

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    try { localStorage.setItem(KEY, theme) } catch { /* private mode: still works for this visit */ }
  }, [theme])

  return { theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) }
}
