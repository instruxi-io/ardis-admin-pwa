import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { PublicAccount, JwtClaims } from '@/types/enforcer/auth'
import { decodeJwt, isTokenExpired, tokenStorage } from '@/lib/jwt'
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
  sendOtp: (email: string) => Promise<void>
  verifyOtp: (email: string, otp: string) => Promise<void>
  setActiveTenant: (tenantId: string) => void
  logout: () => void
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

  useEffect(() => {
    if (!clientInitialised.current) {
      createEnforcerApiClient({ baseURL: env.ENFORCER_BASE_URL, getJwtToken: getToken })
      clientInitialised.current = true
    }

    const token = tokenStorage.getToken()
    if (token && !isTokenExpired(token)) {
      const claims = decodeJwt(token)
      setState({
        ready: true,
        authenticated: true,
        account: null,
        claims,
        activeTenantId: claims?.tenant_id ?? null,
      })
    } else {
      tokenStorage.clear()
      setState((s) => ({ ...s, ready: true }))
    }
  }, [])

  const sendOtp = async (email: string) => {
    await getEnforcerApiClient().post<BaseResponse>('/api/v1/enforcer/auth/login', { email })
  }

  const verifyOtp = async (email: string, otp: string) => {
    const res = await getEnforcerApiClient().post<VerifyAuthResponse>(
      '/api/v1/enforcer/auth/login/verify',
      { email, otp }
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

  const setActiveTenant = (tenantId: string) => {
    setState((s) => ({ ...s, activeTenantId: tenantId }))
    localStorage.setItem('ardis_admin_active_tenant', tenantId)
  }

  const logout = () => {
    tokenStorage.clear()
    localStorage.removeItem('ardis_admin_active_tenant')
    setState({ ready: true, authenticated: false, account: null, claims: null, activeTenantId: null })
  }

  return (
    <AuthContext.Provider value={{ ...state, sendOtp, verifyOtp, setActiveTenant, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
