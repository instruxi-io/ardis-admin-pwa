import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { UserPlus } from 'lucide-react'
import { vendorTeamApi } from '@/lib/ardisMsClient'
import { Button } from './button'
import { Input } from './input'
import { InfoDot } from './tooltip'

/**
 * Adds one of the vendor's own people to their own company area.
 *
 * Previously every "please give our QA person a login" was an email to us and
 * a wait, because Enforcer refuses user creation to a vendor credential, which
 * is correct. The server does the two calls with the platform key after
 * checking the caller may act for that vendor, and always with the developer
 * role, so this cannot become a way to grant more than a colleague's seat.
 */
export function AddTeammate() {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')

  const add = useMutation({
    mutationFn: () => vendorTeamApi.add(email.trim(), first.trim(), last.trim()),
    onSuccess: () => {
      toast.success(`${email.trim()} can now sign in. They get a code by email, no password.`)
      setEmail(''); setFirst(''); setLast(''); setOpen(false)
    },
    onError: (e: unknown) => {
      const said = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(said?.trim() || 'Could not add them')
    },
  })

  const valid = /\S+@\S+\.\S+/.test(email.trim())

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <UserPlus size={14} className="mr-1.5" />Add someone from your team
      </Button>
    )
  }

  return (
    <div className="rounded-md border border-border bg-surface p-4 space-y-3 max-w-xl">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Add someone from your team</span>
        <InfoDot title="What this does">
          Creates a login for a colleague and puts them in your company area. They
          sign in with a code sent to their email, so there is no password to share.
          They see the same things you do: your catalogue, your delivery settings
          and your orders. Nothing outside your company.
        </InfoDot>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input placeholder="First name" value={first} onChange={e => setFirst(e.target.value)} />
        <Input placeholder="Last name" value={last} onChange={e => setLast(e.target.value)} />
      </div>
      <Input
        placeholder="their.email@company.com"
        value={email}
        onChange={e => setEmail(e.target.value)}
        autoFocus
      />
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={!valid || add.isPending} onClick={() => add.mutate()}>
          {add.isPending ? 'Adding…' : 'Add them'}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  )
}
