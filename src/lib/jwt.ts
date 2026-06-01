import type { JwtClaims } from '@/types/enforcer/auth'

export function decodeJwt(token: string): JwtClaims | null {
  try {
    const payload = token.split('.')[1]
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(decoded) as JwtClaims
  } catch {
    return null
  }
}

export function isTokenExpired(token: string): boolean {
  const claims = decodeJwt(token)
  if (!claims) return true
  return Date.now() >= claims.exp * 1000
}

const TOKEN_KEY = 'ardis_admin_token'
const REFRESH_KEY = 'ardis_admin_refresh'
const API_KEY_KEY = 'ardis_admin_api_key'

export const tokenStorage = {
  getToken: () => localStorage.getItem(TOKEN_KEY),
  setToken: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  getRefresh: () => localStorage.getItem(REFRESH_KEY),
  setRefresh: (t: string) => localStorage.setItem(REFRESH_KEY, t),
  clear: () => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(REFRESH_KEY)
    localStorage.removeItem(API_KEY_KEY)
  },
}

export const apiKeyStorage = {
  get: () => localStorage.getItem(API_KEY_KEY),
  set: (k: string) => localStorage.setItem(API_KEY_KEY, k),
  clear: () => localStorage.removeItem(API_KEY_KEY),
}
