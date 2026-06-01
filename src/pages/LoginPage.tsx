import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { EnforcerApiError } from '@/lib/enforcerApiClient'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Building2, ArrowRight, KeyRound, Mail } from 'lucide-react'

type Step = 'email' | 'tenant-pick' | 'otp'
type LoginMode = 'otp' | 'apikey'

export default function LoginPage() {
  const { ready, authenticated, claims, account } = useAuth()
  const { sendOtp, verifyOtp, apiKeyLogin } = useAuth()
  const [mode, setMode] = useState<LoginMode>('otp')
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [tenantCode, setTenantCode] = useState<string | undefined>()
  const [availableTenants, setAvailableTenants] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  if (!ready) return null

  if (authenticated) {
    const role = claims?.role ?? account?.role
    const dest = role === 'admin' ? '/tenants' : '/dashboard'
    return <Navigate to={dest} replace />
  }

  const attemptSendOtp = async (emailVal: string, code?: string) => {
    setLoading(true)
    try {
      await sendOtp(emailVal, code)
      setTenantCode(code)
      setStep('otp')
      toast.success('Check your email for a 6-digit code')
    } catch (err) {
      if (err instanceof EnforcerApiError) {
        const data = err.details?.responseData as { tenants?: string[]; data?: string[] } | undefined
        const tenants = data?.tenants ?? data?.data ?? []
        if (tenants.length > 0) {
          setAvailableTenants(tenants)
          setStep('tenant-pick')
          return
        }
      }
      toast.error(err instanceof Error ? err.message : 'Failed to send OTP')
    } finally {
      setLoading(false)
    }
  }

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return
    await attemptSendOtp(email)
  }

  const handlePickTenant = async (code: string) => {
    await attemptSendOtp(email, code)
  }

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!otp) return
    setLoading(true)
    try {
      await verifyOtp(email, otp, tenantCode)
      // navigation handled by the Navigate component above on re-render
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Invalid or expired code')
      setOtp('')
    } finally {
      setLoading(false)
    }
  }

  const handleApiKeyLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!apiKey) return
    setLoading(true)
    try {
      await apiKeyLogin(apiKey)
      // navigation handled by Navigate above on re-render
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Invalid API key')
      setApiKey('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary text-primary-foreground text-xl font-bold mb-2">
            A
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Ardis Admin</h1>
          <p className="text-sm text-muted-foreground">Platform administration portal</p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex rounded-md border border-border overflow-hidden mb-3">
              <button
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors ${mode === 'otp' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
                onClick={() => { setMode('otp'); setStep('email') }}
              >
                <Mail size={13} /> Email OTP
              </button>
              <button
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors ${mode === 'apikey' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
                onClick={() => setMode('apikey')}
              >
                <KeyRound size={13} /> API Key
              </button>
            </div>
            <CardTitle className="text-base">
              {mode === 'apikey' && 'Sign in with API key'}
              {mode === 'otp' && step === 'email' && 'Sign in'}
              {mode === 'otp' && step === 'tenant-pick' && 'Select your tenant'}
              {mode === 'otp' && step === 'otp' && 'Enter verification code'}
            </CardTitle>
            <CardDescription>
              {mode === 'apikey' && 'Paste your Enforcer API key'}
              {mode === 'otp' && step === 'email' && 'Enter your admin email address'}
              {mode === 'otp' && step === 'tenant-pick' && 'Your account exists on multiple tenants. Choose which one to sign into.'}
              {mode === 'otp' && step === 'otp' && `We sent a 6-digit code to ${email}${tenantCode ? ` (${tenantCode})` : ''}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {mode === 'apikey' && (
              <form onSubmit={handleApiKeyLogin} className="space-y-3">
                <Input
                  type="password"
                  placeholder="enf_••••••••••••••••"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  autoFocus
                  required
                />
                <Button type="submit" className="w-full" disabled={loading || apiKey.length < 8}>
                  {loading ? 'Verifying…' : 'Sign in'}
                </Button>
              </form>
            )}

            {mode === 'otp' && step === 'email' && (
              <form onSubmit={handleSendOtp} className="space-y-3">
                <Input
                  type="email"
                  placeholder="admin@ardisdata.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus
                  required
                />
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Sending…' : 'Send code'}
                </Button>
              </form>
            )}

            {mode === 'otp' && step === 'tenant-pick' && (
              <div className="space-y-2">
                {availableTenants.map((code) => (
                  <button
                    key={code}
                    onClick={() => handlePickTenant(code)}
                    disabled={loading}
                    className="w-full text-left group"
                  >
                    <div className="flex items-center justify-between p-3 rounded-md border border-border hover:border-primary/50 hover:bg-accent/50 transition-all">
                      <div className="flex items-center gap-2">
                        <Building2 size={15} className="text-muted-foreground" />
                        <span className="text-sm font-medium">{code}</span>
                      </div>
                      <ArrowRight size={14} className="text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                  </button>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-muted-foreground mt-1"
                  onClick={() => { setStep('email'); setAvailableTenants([]) }}
                >
                  Use a different email
                </Button>
              </div>
            )}

            {mode === 'otp' && step === 'otp' && (
              <form onSubmit={handleVerifyOtp} className="space-y-3">
                {tenantCode && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted text-xs text-muted-foreground">
                    <Building2 size={12} />
                    <span>{tenantCode}</span>
                    <Badge variant="secondary" className="ml-auto">selected</Badge>
                  </div>
                )}
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  placeholder="123456"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  autoFocus
                  required
                />
                <Button type="submit" className="w-full" disabled={loading || otp.length < 6}>
                  {loading ? 'Verifying…' : 'Sign in'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full text-muted-foreground"
                  onClick={() => { setStep('email'); setOtp(''); setTenantCode(undefined) }}
                >
                  Use a different email
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
