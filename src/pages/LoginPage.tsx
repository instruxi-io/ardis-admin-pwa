import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'

type Step = 'email' | 'otp'

export default function LoginPage() {
  const { sendOtp, verifyOtp, authenticated, claims } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)

  if (authenticated) {
    const dest = claims?.role === 'admin' ? '/tenants' : '/dashboard'
    navigate(dest, { replace: true })
    return null
  }

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return
    setLoading(true)
    try {
      await sendOtp(email)
      setStep('otp')
      toast.success('Check your email for a 6-digit code')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send OTP')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!otp) return
    setLoading(true)
    try {
      await verifyOtp(email, otp)
      const dest = claims?.role === 'admin' ? '/tenants' : '/dashboard'
      navigate(dest, { replace: true })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Invalid or expired code')
      setOtp('')
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
          <CardHeader className="pb-4">
            <CardTitle className="text-base">
              {step === 'email' ? 'Sign in' : 'Enter verification code'}
            </CardTitle>
            <CardDescription>
              {step === 'email'
                ? 'Enter your admin email address'
                : `We sent a 6-digit code to ${email}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {step === 'email' ? (
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
            ) : (
              <form onSubmit={handleVerifyOtp} className="space-y-3">
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
                  onClick={() => { setStep('email'); setOtp('') }}
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
