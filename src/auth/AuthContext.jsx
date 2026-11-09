import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { getMe, login as apiLogin, logout as apiLogout, setUnauthorizedHandler } from '../data/storage'

const AuthContext = createContext(null)

// Mirrors lib/auth.js PERMISSIONS — the server enforces them; the UI only hides what can't be used
export const can = (user, permission) =>
  !!user && (user.permissions || []).some((p) => p === '*' || p === permission)

// Where each role lands after logging in
export const homeFor = (user) => {
  if (!user) return '/login'
  if (user.role === 'reseller') return `/resellers/${user.resellerId}`
  return user.permissions?.some((p) => p === '*' || p === 'orders:read') ? '/dashboard' : '/'
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined)   // undefined = still checking, null = logged out

  useEffect(() => {
    getMe().then(setUser).catch(() => setUser(null))
    setUnauthorizedHandler(() => setUser(null))
  }, [])

  const login = useCallback(async (username, password) => {
    const u = await apiLogin(username, password)
    setUser(u)
    return u
  }, [])

  const logout = useCallback(async () => {
    try { await apiLogout() } finally { setUser(null) }
  }, [])

  return (
    <AuthContext.Provider value={{ user, login, logout, can: (p) => can(user, p) }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
