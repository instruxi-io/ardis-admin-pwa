import axios from 'axios'
import { env } from '@/config/env'
import { tokenStorage, apiKeyStorage } from '@/lib/jwt'

// Axios client for ardis-ms authenticated endpoints (/display-schemas, etc.).
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

// The server says exactly why it rejected a publish ({success, error, message})
// but axios' default message is "Request failed with status code 400", and that
// is what the publish log showed a vendor while the real reason — for example
// "x_pricing.options[0].value is required" — sat unread in the response body.
// Rewrite the error message once here so every caller's catch shows the reason.
ardisMsClient.interceptors.response.use(undefined, (error) => {
  const body = error?.response?.data
  if (body && typeof body.message === 'string' && body.message.trim() !== '') {
    error.message = body.error
      ? `${body.message} (${body.error})`
      : body.message
  }
  return Promise.reject(error)
})

export interface SchemaIndexEntry {
  verifier_id: string
  credential_type: string
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
  credential_type: string
  version: string
  data_schema: Record<string, unknown>
  ui_schema: Record<string, unknown>
  sample_data?: Record<string, unknown>
}

export interface SchemaContent {
  data_schema: Record<string, unknown>
  ui_schema: Record<string, unknown>
  sample_data?: Record<string, unknown>
}

export interface PricingTierOption {
  value: string
  price_id: string
  amount: number       // cents
  currency: string
  interval: string     // 'month' | 'year' | '' = one-time
}

export interface ProductPricing {
  model: 'tiered'
  field: string        // order_schema field key that selects the tier
  options: PricingTierOption[]
}

export interface ProductAddon {
  field: string        // order_schema boolean field key
  label?: string       // display label (falls back to field title)
  price_id: string
  amount: number       // cents
  currency: string
  interval: string
}

export interface ProductEntry {
  id?: string
  stripe_product_id?: string
  name: string
  description?: string
  verifier_name?: string
  verifier_id?: string
  // Stable product identity within a verifier: ardis-ms resolves products by
  // (verifier_id, sku). Defaults server-side to a slug of the name when absent.
  sku?: string
  credential_type?: string
  order_type?: string
  verifier_logo_url?: string
  price_one_time?: number
  price_monthly?: number
  currency?: string
  active?: boolean
  order_schema?: Record<string, unknown>
  order_ui_schema?: Record<string, unknown>
  display_schema_path?: string
  pricing?: ProductPricing
  addons?: ProductAddon[]
  published_at?: string
  published_by?: string
  // Sent on publish, returned in the product response. These were absent from the
  // type, so every publish call cast the whole payload to `any` — which is also
  // why price_currency could be added without anything checking it reached here.
  version?: string
  x_pricing?: unknown
  product_role?: string
  price_currency?: string
  sample_data?: unknown
}

export const productsApi = {
  list: async (): Promise<ProductEntry[]> => {
    const res = await ardisMsClient.get<{ success: boolean; data: ProductEntry[] }>('/products')
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

export interface SchemaDriftRecord {
  verifier_id: string
  credential_type: string
  version: string
  undeclared_fields: string[]
  unused_fields: string[]
  reports: number
  first_seen: string
  last_seen: string
}

export const schemasApi = {
  // ardis-ms registers these as /credential-schemas (renamed from
  // display-schemas). The path here must match or the list comes back empty.
  // What real credentials carried versus what the schema declares. Reported by
  // the app when it renders a credential, because only a real payload knows.
  drift: async (): Promise<SchemaDriftRecord[]> => {
    const res = await ardisMsClient.get<{ success: boolean; data: SchemaDriftRecord[] }>(
      '/credential-schemas/drift')
    return res.data.data ?? []
  },

  list: async (): Promise<SchemaIndexEntry[]> => {
    const res = await ardisMsClient.get<SchemaListResponse>('/credential-schemas')
    return res.data.data ?? []
  },

  get: async (verifierId: string, credentialType: string, version: string): Promise<SchemaContent> => {
    const res = await ardisMsClient.get<{ success: boolean; data: SchemaContent }>(
      `/public/credential-schemas/${verifierId}/${credentialType}/${version}`
    )
    return res.data.data
  },

  publish: async (payload: PublishSchemaPayload): Promise<SchemaIndexEntry> => {
    const res = await ardisMsClient.post<{ success: boolean; data: SchemaIndexEntry }>('/credential-schemas', payload)
    return res.data.data
  },
}

export interface OrderDelivery {
  at: string
  ok: boolean
  detail?: string           // the vendor's own refusal text, truncated
}

export interface OrderRoute {
  credential_type: string   // normalised key, eg "portable_verification"
  order_url: string
  order_type: string        // what the vendor's own API calls this order, when it differs
  // Outcome of the most recent delivery attempt. Absent means no order yet.
  // Configured is not the same as working: without this the panel showed a
  // green tick over an endpoint that had refused every order sent to it.
  last_delivery?: OrderDelivery
}

export interface OrderRoutes {
  verifier_id: string
  default_order_url: string // where anything without its own entry is delivered
  routes: OrderRoute[]
}

// Credential types become metadata keys, and the server normalises them the
// same way. Matching a type to its route in the UI has to use the same rule or
// a hyphenated type looks unrouted when it is routed.
export const routeKey = (credentialType: string) =>
  credentialType.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_')

export const orderRoutesApi = {
  get: async (): Promise<OrderRoutes> => {
    const res = await ardisMsClient.get<{ success: boolean; data: OrderRoutes }>('/vendor/routes')
    return res.data.data
  },

  set: async (credentialType: string, orderUrl: string, orderType?: string): Promise<void> => {
    await ardisMsClient.put(`/vendor/routes/${encodeURIComponent(credentialType)}`, {
      order_url: orderUrl,
      order_type: orderType ?? '',
    })
  },
}

export interface VendorOrder {
  order_id: string
  credential_type: string
  sku: string
  status: string
  placed_at: string
  updated_at: string
  vendor_order_id: string
  delivery?: {
    state: string
    attempts: number
    last_error: string
    /** The vendor's own endpoint refused it and our standby fulfilled it. */
    served_by_standby?: boolean
    standby_reason?: string
  }
  /** Set when the order has been with this vendor, unanswered, past the platform's patience. */
  waiting_on_you_seconds?: number
}

export const vendorOrdersApi = {
  list: async (): Promise<VendorOrder[]> => {
    const res = await ardisMsClient.get<{ success: boolean; data: { orders: VendorOrder[] } }>(
      '/vendor/orders')
    return res.data.data?.orders ?? []
  },
}

export const vendorTeamApi = {
  add: async (email: string, firstName?: string, lastName?: string): Promise<void> => {
    await ardisMsClient.post('/vendor/users', {
      email,
      first_name: firstName ?? '',
      last_name: lastName ?? '',
    })
  },
}
