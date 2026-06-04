import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { PublicAccount, JwtClaims } from '@/types/enforcer/auth'
import { decodeJwt, isTokenExpired, tokenStorage, apiKeyStorage } from '@/lib/jwt'
import { createEnforcerApiClient, getEnforcerApiClient } from '@/lib/enforcerApiClient'
import { env } from '@/config/env'
import type { VerifyAuthResponse } from '@/types/enforcer/auth'
import type { BaseResponse } from '@/types/enforcer/common'

interface AuthState {
  ready: boolean
  authenticated: boolean
  account: PublicAccount | null
  claims: JwtClaims | null
  activeTenantId: string | null
}

interface AuthContextValue extends AuthState {
  sendOtp: (email: string, tenantCode?: string) => Promise<void>
  verifyOtp: (email: string, otp: string, tenantCode?: string) => Promise<void>
  apiKeyLogin: (apiKey: string) => Promise<void>
  setActiveTenant: (tenantId: string) => void
  logout: () => void
  role: string | null
  username: string | null
  isDeveloper: boolean
  isTenantAdmin: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    ready: false,
    authenticated: false,
    account: null,
    claims: null,
    activeTenantId: null,
  })

  const clientInitialised = useRef(false)

  const getToken = () => tokenStorage.getToken()
  const getApiKey = () => apiKeyStorage.get()

  useEffect(() => {
    if (!clientInitialised.current) {
      createEnforcerApiClient({ baseURL: env.ENFORCER_BASE_URL, getJwtToken: getToken, getApiKey })
      clientInitialised.current = true
    }

    const token = tokenStorage.getToken()
    if (token && !isTokenExpired(token)) {
      const claims = decodeJwt(token)
      // Fetch full account so username + role name are available for VP scoping.
      getEnforcerApiClient()
        .get<BaseResponse & { data: PublicAccount }>('users/me')
        .then((res) => {
          setState({
            ready: true,
            authenticated: true,
            account: res.data,
            claims,
            activeTenantId: claims?.tenant_id ?? null,
          })
        })
        .catch(() => {
          setState({
            ready: true,
            authenticated: true,
            account: null,
            claims,
            activeTenantId: claims?.tenant_id ?? null,
          })
        })
      return
    }

    const storedKey = apiKeyStorage.get()
    if (storedKey) {
      getEnforcerApiClient()
        .get<BaseResponse & { data: PublicAccount }>('users/me')
        .then((res) => {
          setState({
            ready: true,
            authenticated: true,
            account: res.data,
            claims: null,
            activeTenantId: res.data.tenant_id ?? null,
          })
        })
        .catch(() => {
          apiKeyStorage.clear()
          setState((s) => ({ ...s, ready: true }))
        })
      return
    }

    tokenStorage.clear()
    setState((s) => ({ ...s, ready: true }))
  }, [])

  const sendOtp = async (email: string, tenantCode?: string) => {
    await getEnforcerApiClient().post<BaseResponse>('auth/login', {
      email,
      ...(tenantCode ? { tenant_code: tenantCode } : {}),
    })
  }

  const verifyOtp = async (email: string, otp: string, tenantCode?: string) => {
    const res = await getEnforcerApiClient().post<VerifyAuthResponse>(
      'auth/login/verify',
      {
        email,
        otp,
        ...(tenantCode ? { tenant_code: tenantCode } : {}),
      }
    )
    const token = res.data.token
    tokenStorage.setToken(token)
    const claims = decodeJwt(token)
    setState({
      ready: true,
      authenticated: true,
      account: res.data.account,
      claims,
      activeTenantId: claims?.tenant_id ?? null,
    })
  }

  const apiKeyLogin = async (apiKey: string) => {
    apiKeyStorage.set(apiKey)
    const res = await getEnforcerApiClient().get<BaseResponse & { data: PublicAccount }>('users/me')
    setState({
      ready: true,
      authenticated: true,
      account: res.data,
      claims: null,
      activeTenantId: res.data.tenant_id ?? null,
    })
  }

  const setActiveTenant = (tenantId: string) => {
    setState((s) => ({ ...s, activeTenantId: tenantId }))
    localStorage.setItem('ardis_admin_active_tenant', tenantId)
  }

  const logout = () => {
    tokenStorage.clear()
    apiKeyStorage.clear()
    localStorage.removeItem('ardis_admin_active_tenant')
    setState({ ready: true, authenticated: false, account: null, claims: null, activeTenantId: null })
  }

  // account.role comes back from Enforcer as {id, name} at runtime despite
  // being typed as string — extract the name safely.
  const rawRole = state.account?.role
  const accountRole = rawRole
    ? typeof rawRole === 'object'
      ? (rawRole as unknown as { name: string }).name?.toLowerCase() ?? null
      : (rawRole as string).toLowerCase()
    : null
  const role = accountRole ?? state.claims?.role?.toLowerCase() ?? null
  const username = state.account?.username ?? null
  const isDeveloper = role === 'developer'
  const isTenantAdmin = role === 'tenant_admin' || role === 'admin'

  return (
    <AuthContext.Provider value={{ ...state, sendOtp, verifyOtp, apiKeyLogin, setActiveTenant, logout, role, username, isDeveloper, isTenantAdmin }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
