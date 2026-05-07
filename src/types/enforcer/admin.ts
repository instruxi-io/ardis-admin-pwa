// ── Users ──────────────────────────────────────────────────────────────────

export interface UserListItem {
  id: string
  username?: string
  first_name?: string
  last_name?: string
  email?: string
  email_verified?: boolean
  phone_number?: string
  phone_number_verified?: boolean
  active: boolean
  tenant_id?: string
  account_address?: string
  wallet_address?: string
  kyc_verified?: boolean
  kyc_expires_at?: string
  deleted_at?: string
  role?: string
}

export interface UsersListParams {
  limit?: number
  offset?: number
  group_id?: string
  user_id?: string
  username?: string
  first_name?: string
  last_name?: string
  include_deleted?: boolean
  require_verified?: string
  profile_incomplete?: boolean
}

export interface ResolvedUser {
  user_id: string
  account_address: string
  username?: string
  first_name?: string
  last_name?: string
}

export interface ChangeRoleRequest {
  role: string
}

export interface VerifyContactRequest {
  user_id: string
  email_verified?: boolean
  phone_number_verified?: boolean
}

// ── Groups ─────────────────────────────────────────────────────────────────

export interface AdminGroup {
  id: string
  name: string
  description?: string
  tenant_id: string
  created_at: string
  updated_at: string
  member_count?: number
}

export interface GroupsListParams {
  limit?: number
  offset?: number
}

// ── Roles ──────────────────────────────────────────────────────────────────

export interface AdminRole {
  id: string
  name: string
  tenant_id: string
  created_at: string
}

// ── Sessions ───────────────────────────────────────────────────────────────

export type SessionStatus = 'pending' | 'active' | 'verified' | 'expired' | 'revoked' | 'failed'

export interface AdminSession {
  id: string
  session_id: string
  session_type: string
  user_id: string
  tenant_id: string
  provider_id?: string
  status: SessionStatus
  attempt_count: number
  last_error?: string
  expires_at: string
  verified_at?: string
  created_at: string
  updated_at: string
}

export interface ListSessionsParams {
  limit?: number
  offset?: number
  status?: SessionStatus
  session_type?: string
  user_id?: string
}

export interface UpdateSessionStatusRequest {
  status: SessionStatus
  reason: string
}

// ── Terms ──────────────────────────────────────────────────────────────────

export interface AdminTerm {
  id: string
  type: string
  version: string
  content: string
  tenant_id: string
  created_at: string
  updated_at: string
}

export interface CreateTermRequest {
  type: string
  version: string
  content: string
}

export interface UpdateTermRequest {
  version?: string
  content?: string
}

// ── Tenants ────────────────────────────────────────────────────────────────

export interface AdminTenant {
  id: string
  name: string
  code: string
  active: boolean
  account_count?: number
  created_at: string
  updated_at: string
}

export interface TenantsListParams {
  limit?: number
  offset?: number
}
