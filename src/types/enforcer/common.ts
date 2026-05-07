export interface BaseResponse {
  success: boolean
  message: string
  error?: string
}

export interface PaginatedResponse<T> extends BaseResponse {
  data: T[]
  total: number
  limit: number
  offset: number
}
