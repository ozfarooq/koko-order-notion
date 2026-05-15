const KEY = 'koko_auth'

export const login = (username, password) => {
  if (username === 'omer' && password === 'omer') {
    sessionStorage.setItem(KEY, '1')
    return true
  }
  return false
}

export const logout = () => sessionStorage.removeItem(KEY)

export const isLoggedIn = () => sessionStorage.getItem(KEY) === '1'
