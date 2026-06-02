import axios from 'axios'
import { env } from '@/config/env'
import { tokenStorage, apiKeyStorage } from '@/lib/jwt'

// Axios client for ardis-ms authenticated endpoints (/schemas, etc.).
// The same Bearer JWT or X-API-Key that works with Enforcer works here —
// ardis-ms validates credentials through the same Enforcer auth middleware.
const ardisMsClient = axios.create({
  baseURL: env.ARDIS_MS_URL,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
})

ardisMsClient.interceptors.request.use((cfg) => {
  const apiKey = apiKeyStorage.get()
  if (apiKey) {
    cfg.headers['X-API-Key'] = apiKey
  } else {
    const token = tokenStorage.getToken()
    if (token) cfg.headers.Authorization = `Bearer ${token}`
  }
  return cfg
})

export interface SchemaIndexEntry {
  verifier_id: string
  version: string
  published_at: string
  published_by: string
}

export interface SchemaListResponse {
  success: boolean
  message: string
  data: SchemaIndexEntry[]
}

export interface PublishSchemaPayload {
  verifier_id: string
  version: string
  data_schema: Record<string, unknown>
  ui_schema: Record<string, unknown>
}

export interface ProductEntry {
  id: string
  name: string
  description?: string
  verifier_name?: string
  verifier_id?: string
  verifier_logo_url?: string
  price_one_time?: number
  price_monthly?: number
  currency?: string
  active?: boolean
  order_schema?: Record<string, unknown>
  order_ui_schema?: Record<string, unknown>
  credential_data_schema?: Record<string, unknown>
  credential_ui_schema?: Record<string, unknown>
  schema_version?: string
  published_at?: string
  published_by?: string
}

export const productsApi = {
  list: async (): Promise<ProductEntry[]> => {
    const res = await ardisMsClient.get<{ success: boolean; data: ProductEntry[] }>('/public/products')
    return res.data.data ?? []
  },

  publish: async (product: ProductEntry): Promise<ProductEntry> => {
    const res = await ardisMsClient.post<{ success: boolean; data: ProductEntry }>('/products', product)
    return res.data.data
  },

  delete: async (id: string): Promise<void> => {
    await ardisMsClient.delete(`/products/${id}`)
  },
}

export interface SchemaContent {
  data_schema: Record<string, unknown>
  ui_schema: Record<string, unknown>
}

export const schemasApi = {
  list: async (): Promise<SchemaIndexEntry[]> => {
    const res = await ardisMsClient.get<SchemaListResponse>('/schemas')
    return res.data.data ?? []
  },

  get: async (verifierId: string, version: string): Promise<SchemaContent> => {
    const res = await ardisMsClient.get<{ success: boolean; data: SchemaContent }>(
      `/public/schemas/${verifierId}/${version}`
    )
    return res.data.data
  },

  publish: async (payload: PublishSchemaPayload): Promise<SchemaIndexEntry> => {
    const res = await ardisMsClient.post<{ success: boolean; data: SchemaIndexEntry }>('/schemas', payload)
    return res.data.data
  },
}
