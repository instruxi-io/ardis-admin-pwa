import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from 'axios'
import { env } from '@/config/env'

export class EnforcerApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public details?: {
      requestUrl?: string
      requestMethod?: string
      responseData?: unknown
      serverErrorCode?: string
    }
  ) {
    super(message)
    this.name = 'EnforcerApiError'
  }
}

export interface EnforcerApiClientConfig {
  baseURL?: string
  getJwtToken: () => string | null
  getApiKey?: () => string | null
  maxRetries?: number
  baseDelay?: number
}

export class EnforcerApiClient {
  private axiosInstance: AxiosInstance
  private getJwtToken: () => string | null
  private getApiKey: () => string | null
  private maxRetries: number
  private baseDelay: number

  constructor(config: EnforcerApiClientConfig) {
    this.getJwtToken = config.getJwtToken
    this.getApiKey = config.getApiKey ?? (() => null)
    this.maxRetries = config.maxRetries ?? 3
    this.baseDelay = config.baseDelay ?? 1000

    this.axiosInstance = axios.create({
      baseURL: config.baseURL ?? env.ENFORCER_BASE_URL,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    })

    this.axiosInstance.interceptors.request.use(async (cfg) => {
      const url = cfg.url ?? ''
      const isPublic = url.includes('/public/')
      if (!isPublic) {
        const apiKey = this.getApiKey()
        if (apiKey) {
          cfg.headers['X-API-Key'] = apiKey
        } else {
          const token = this.getJwtToken()
          if (token) cfg.headers.Authorization = `Bearer ${token}`
        }
      }
      if (cfg.data instanceof FormData) delete cfg.headers['Content-Type']
      return cfg
    })

    this.axiosInstance.interceptors.response.use(
      (r) => r,
      async (error) => {
        const original = error.config
        const status = error.response?.status

        if (status === 401 && !original?._authRetried) {
          original._authRetried = true
          const fresh = this.getJwtToken()
          if (fresh) {
            original.headers.Authorization = `Bearer ${fresh}`
            return this.axiosInstance(original)
          }
        }

        if (
          !original._retry &&
          this.isRetryable(error) &&
          (original._retryCount ?? 0) < this.maxRetries
        ) {
          original._retry = true
          original._retryCount = (original._retryCount ?? 0) + 1
          await this.sleep(this.baseDelay * Math.pow(2, original._retryCount - 1))
          return this.axiosInstance(original)
        }

        return Promise.reject(error)
      }
    )
  }

  private isRetryable(error: unknown): boolean {
    if (!(error as { response?: unknown }).response) return true
    const status = (error as { response: { status: number } }).response.status
    return status >= 500 || status === 429
  }

  private sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms))
  }

  private buildQuery(params?: Record<string, unknown>): string {
    if (!params) return ''
    const sp = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) sp.append(k, String(v))
    }
    const s = sp.toString()
    return s ? `?${s}` : ''
  }

  async get<T>(url: string, params?: Record<string, unknown>, config?: AxiosRequestConfig): Promise<T> {
    try {
      const r: AxiosResponse<T> = await this.axiosInstance.get(`${url}${this.buildQuery(params)}`, config)
      return r.data
    } catch (e) {
      throw this.handleError(e, 'GET', url)
    }
  }

  async post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    try {
      const r: AxiosResponse<T> = await this.axiosInstance.post(url, data, config)
      return r.data
    } catch (e) {
      throw this.handleError(e, 'POST', url)
    }
  }

  async put<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    try {
      const r: AxiosResponse<T> = await this.axiosInstance.put(url, data, config)
      return r.data
    } catch (e) {
      throw this.handleError(e, 'PUT', url)
    }
  }

  async patch<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    try {
      const r: AxiosResponse<T> = await this.axiosInstance.patch(url, data, config)
      return r.data
    } catch (e) {
      throw this.handleError(e, 'PATCH', url)
    }
  }

  async delete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    try {
      const r: AxiosResponse<T> = await this.axiosInstance.delete(url, config)
      return r.data
    } catch (e) {
      throw this.handleError(e, 'DELETE', url)
    }
  }

  private handleError(error: unknown, method: string, url: string): EnforcerApiError {
    if (error instanceof EnforcerApiError) return error
    const e = error as { response?: { status: number; data?: { error?: string; message?: string } }; request?: unknown; message?: string }

    let message = 'An unexpected error occurred'
    let statusCode: number | undefined
    const details: EnforcerApiError['details'] = { requestUrl: url, requestMethod: method }

    if (e.response) {
      statusCode = e.response.status
      details.responseData = e.response.data
      const d = e.response.data
      if (d?.error) {
        details.serverErrorCode = d.error
        message = d.message ?? d.error
      } else if (d?.message) {
        message = d.message
      }
      const statusMessages: Record<number, string> = {
        400: `Bad Request: ${message}`,
        401: 'Unauthorised — invalid or expired credentials',
        403: 'You do not have permission to access this resource',
        404: 'Resource not found',
        429: 'Too many requests — please wait and try again',
        500: 'Server error — please try again later',
      }
      message = statusMessages[statusCode] ?? message
    } else if (e.request) {
      message = 'Network error — no response received'
    } else {
      message = e.message ?? message
    }

    return new EnforcerApiError(message, statusCode, details)
  }
}

let _instance: EnforcerApiClient | null = null

export const createEnforcerApiClient = (config: EnforcerApiClientConfig): EnforcerApiClient => {
  _instance = new EnforcerApiClient(config)
  return _instance
}

export const getEnforcerApiClient = (): EnforcerApiClient => {
  if (!_instance) throw new Error('EnforcerApiClient not initialised — call createEnforcerApiClient first')
  return _instance
}
