const required = (key: string): string => {
  const val = import.meta.env[key]
  if (!val) throw new Error(`Missing required env var: ${key}`)
  return val
}

export const env = {
  ENFORCER_BASE_URL: required('VITE_ENFORCER_BASE_URL'),
  APP_ENV: (import.meta.env.VITE_APP_ENV as string) ?? 'production',
}
