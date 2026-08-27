import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, Send } from 'lucide-react'
import { orderRoutesApi, routeKey, type OrderRoutes } from '@/lib/ardisMsClient'
import { Card, CardContent, CardHeader, CardTitle } from './card'
import { Button } from './button'
import { Input } from './input'
import { InfoDot } from './tooltip'

/**
 * Route keys normalise a credential type to underscores. The vendor wrote it
 * with hyphens and every other surface shows it that way, so show theirs: three
 * spellings of one name across a page is its own support ticket.
 */
const displayType = (routeKey: string) => routeKey.replace(/_/g, '-')

/**
 * Where each of your products' orders is delivered.
 *
 * A product published for a credential type with no endpoint of its own has
 * its orders sent to the account default, which during an integration is the
 * Instruxi stand-in. That is invisible until a live order never arrives, and
 * the fix used to be an email asking us to edit a config value by hand. This
 * shows the destination before an order is placed, and lets the person who
 * knows the address type it in.
 */
export function OrderDelivery({ credentialTypes }: { credentialTypes: string[] }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<string | null>(null)
  const [confirmStop, setConfirmStop] = useState<string | null>(null)
  const [draftUrl, setDraftUrl] = useState('')
  const [draftType, setDraftType] = useState('')

  const { data, isLoading, isError } = useQuery<OrderRoutes>({
    queryKey: ['vendor-routes'],
    queryFn: orderRoutesApi.get,
    retry: false,
  })

  const save = useMutation({
    mutationFn: ({ type, url, orderType }: { type: string; url: string; orderType: string }) =>
      orderRoutesApi.set(type, url, orderType),
    onSuccess: (_r, v) => {
      queryClient.invalidateQueries({ queryKey: ['vendor-routes'] })
      setEditing(null)
      setConfirmStop(null)
      toast.success(v.url
        ? `Orders for ${displayType(v.type)} now go to your address. This covers every product that uses this credential type.`
        : `Orders for ${displayType(v.type)} now go to the Instruxi test endpoint. They will be answered with test results and will not reach you.`)
    },
    // The server already says exactly what is wrong ("must be a full https
    // address"). Swallowing it for a generic failure leaves them guessing.
    // Read the body rather than error.message: the shared interceptor appends
    // the machine error code, which means nothing to the person reading it.
    onError: (e: unknown) => {
      const said = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(said?.trim() || 'Could not save that endpoint')
    },
  })

  // A tenant admin belongs to no single vendor, so the endpoint cannot tell
  // which one they mean and answers 400. Nothing useful to show them here.
  if (isLoading || isError || !data) return null

  const byType = new Map(data.routes.map(r => [r.credential_type, r]))
  const types = [...new Set(credentialTypes.map(routeKey))].filter(Boolean).sort()
  if (types.length === 0) return null

  const unrouted = types.filter(t => !byType.get(t)?.order_url).length

  return (
    <Card>
      <CardHeader className="py-4">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Send size={14} />
          <InfoDot title="Where your orders are delivered">
            When someone buys one of your products, we POST the order to an address you
            own. Each credential type can have its own. Anything without one goes to the
            Instruxi test endpoint, which answers orders automatically so testing never
            stalls, but means those orders never reach you.
          </InfoDot>
          Where your orders are delivered
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {unrouted > 0
            ? `${unrouted} of your ${types.length} credential type${types.length === 1 ? '' : 's'} ${unrouted === 1 ? 'is' : 'are'} still going to the Instruxi test endpoint. Add your address and orders reach you instead.`
            : 'Every credential type is pointed at your own endpoint.'}
        </p>
      </CardHeader>
      <CardContent className="p-0">
        {types.map(type => {
          const route = byType.get(type)
          const live = !!route?.order_url
          const isEditing = editing === type
          return (
            <div key={type} className="px-6 py-3 border-t border-border">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono font-medium">{displayType(type)}</span>
                    {live ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                        <CheckCircle2 size={12} />Your endpoint
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                        <AlertTriangle size={12} />Instruxi test endpoint
                      </span>
                    )}
                  </div>
                  {live ? (
                    <p className="text-xs text-muted-foreground font-mono truncate mt-0.5">
                      {route!.order_url}
                    </p>
                  ) : (
                    // Deliberately words, not the URL. Printing our stand-in's
                    // address under their product reads as "our customers'
                    // details are being sent there", which is a compliance
                    // question we do not want to answer by accident.
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Instruxi's test service answers these automatically with test
                      results. Nothing reaches you.
                    </p>
                  )}
                  {route?.order_type && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      We label these "{route.order_type}" when we send them
                    </p>
                  )}
                </div>
                {!isEditing && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditing(type)
                      setDraftUrl(route?.order_url ?? '')
                      setDraftType(route?.order_type ?? '')
                    }}
                  >
                    {live ? 'Change' : 'Use my endpoint'}
                  </Button>
                )}
              </div>

              {isEditing && (
                <div className="mt-3 space-y-2">
                  <div>
                    <label className="text-xs text-muted-foreground">
                      The https address we should send each order to
                    </label>
                    <Input
                      value={draftUrl}
                      onChange={e => setDraftUrl(e.target.value)}
                      placeholder="https://your-api.example.com/order"
                      autoFocus
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Applies to orders placed from now on. Orders already sent stay
                    where they went.
                  </p>
                  <div>
                    <label className="text-xs text-muted-foreground">
                      Leave blank unless your system expects a different word for this order
                    </label>
                    <Input
                      value={draftType}
                      onChange={e => setDraftType(e.target.value)}
                      placeholder={displayType(type)}
                    />
                  </div>
                  {confirmStop === type && (
                    <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
                      <p className="text-xs">
                        Orders for <span className="font-mono">{displayType(type)}</span> will go to
                        Instruxi's test service instead of to you. They will be answered
                        automatically with test results, and you will not receive them.
                        Anything already sent is unaffected.
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={save.isPending}
                          onClick={() => save.mutate({ type, url: '', orderType: '' })}
                        >
                          Yes, stop sending them to me
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setConfirmStop(null)}>
                          Keep my address
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-1">
                    {/* Disabled on an empty box. Clearing the field to retype an
                        address and pressing Save used to unroute the product,
                        silently, through the same call the stop button uses. */}
                    <Button
                      size="sm"
                      disabled={save.isPending || !draftUrl.trim()}
                      onClick={() => save.mutate({ type, url: draftUrl.trim(), orderType: draftType.trim() })}
                    >
                      Save
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => { setEditing(null); setConfirmStop(null) }}>Cancel</Button>
                    {live && (
                      // Sends live, paid orders to our stand-in instead of the
                      // vendor. It asks first, and says what it will do.
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground"
                        disabled={save.isPending}
                        onClick={() => setConfirmStop(type)}
                      >
                        Stop sending these orders to me
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

/**
 * The go-live banner tells a vendor their product is "orderable, end to end".
 * For a brand new credential type that is true of the buying half and false of
 * the delivery half: the orders go to our stand-in, which answers them
 * automatically, so nothing looks broken while nothing reaches the vendor.
 * This says so at the one moment they are looking.
 *
 * Shares the ['vendor-routes'] cache with OrderDelivery, so it costs no extra
 * request. Silent when it cannot tell, never a false alarm.
 */
export function UnroutedWarning({ credentialTypes }: { credentialTypes: string[] }) {
  const { data } = useQuery<OrderRoutes>({
    queryKey: ['vendor-routes'],
    queryFn: orderRoutesApi.get,
    retry: false,
  })
  if (!data) return null
  const routed = new Set(data.routes.filter(r => r.order_url).map(r => r.credential_type))
  const unrouted = [...new Set(credentialTypes.map(routeKey))].filter(t => t && !routed.has(t))
  if (unrouted.length === 0) return null
  return (
    <p className="text-xs text-amber-600">
      One thing left. Orders for {unrouted.map(displayType).join(', ')} still
      come to Instruxi's test endpoint, which answers them automatically, so they will not
      reach you. Set your address under "Where your orders are delivered" below.
    </p>
  )
}
