export interface EmailLoginRequest {
  email: string
  tenant_code?: string
}

export interface EmailLoginVerifyRequest {
  email: string
  otp: string
  tenant_code?: string
  first_name?: string
  last_name?: string
}

export interface PublicAccount {
  id: string
  email?: string
  username?: string
  first_name?: string
  last_name?: string
  tenant_id: string
  role?: string
  active: boolean
}

export interface AuthTokens {
  token: string
  refresh_token?: string
}

export interface VerifyAuthResponse {
  success: boolean
  message: string
  data: {
    account: PublicAccount
    token: string
  }
}

export interface JwtClaims {
  sub: string
  tenant_id: string
  role: string
  email?: string
  exp: number
  iat: number
}
