import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, Clock, Send, XCircle } from 'lucide-react'
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
 * Our stand-in fulfiller, which is the account default during an integration.
 * Recognising it is the only way to tell "a test service is answering these"
 * from "these go to the vendor's own catch-all", and this panel used to assert
 * the first without looking.
 *
 * ponytail: a hardcoded host with an env override, because /vendor/routes says
 * what the default URL is and not whose it is. When a second stand-in appears,
 * that flag belongs on the response beside default_order_url.
 */
const STAND_IN_HOST =
  (import.meta.env.VITE_ORDER_STANDIN_HOST as string | undefined)?.trim() ||
  'ardis-demo-fulfiller.fly.dev'

/**
 * What actually happens to an order for a credential type with no address of
 * its own, read from the account default the server already sent us. An empty
 * default fails the order outright and a default that is the vendor's own
 * catch-all delivers it to them, so neither can be described as a test service.
 */
// Exported for its unit test, which is the only cheap way to cover the three
// branches without a DOM testing library. Costs this file fast refresh.
// eslint-disable-next-line react-refresh/only-export-components
export const unroutedDestination = (defaultURL: string | undefined) => {
  const fallback = defaultURL?.trim() ?? ''
  if (fallback === '') {
    return {
      label: 'Nowhere to deliver',
      fate: 'No address is set for your account either, so these orders are not delivered anywhere and fail.',
    }
  }
  let host = ''
  try {
    host = new URL(fallback).host
  } catch {
    // An unparseable default is still a default; describe it without a host.
  }
  if (host === STAND_IN_HOST) {
    return {
      label: 'Instruxi test endpoint',
      // Deliberately words, not the URL. Printing our stand-in's address under
      // their product reads as "our customers' details are being sent there",
      // which is a compliance question we do not want to answer by accident.
      fate: "Instruxi's test service answers these automatically with test results. Nothing reaches you.",
    }
  }
  return {
    label: 'Your account address',
    fate: `These go to the address set for your whole account${host ? ` (${host})` : ''}, not to one for this credential type.`,
  }
}

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

  const { data, isLoading, isError, error } = useQuery<OrderRoutes>({
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
      // The form saves an address and nothing else. The key we present to it
      // still comes from a deployed environment variable, so promising "orders
      // now go to your address" was half true and the other half showed up as
      // a 401 the vendor could not explain.
      toast.success(v.url
        ? `Address saved for ${displayType(v.type)}, for every product that uses this credential type. If your endpoint checks an API key, send us the one it expects: we cannot set that from here yet, and orders are turned away until we do.`
        : `Orders for ${displayType(v.type)} stop coming to your address. ${unroutedDestination(data?.default_order_url).fate}`)
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

  if (isLoading) return null
  // A tenant admin belongs to no single vendor, so the endpoint cannot tell
  // which one they mean and answers 400. Nothing useful to show them here.
  //
  // Every other failure is a failure. Hiding the card for a 500 or a timeout
  // told a vendor their delivery settings do not exist, durably and silently,
  // and nothing else on the page says otherwise.
  const noVendor = (error as { response?: { status?: number } })?.response?.status === 400
  if (isError && !noVendor) return (
    <Card>
      <CardHeader className="py-4">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Send size={14} />
          Where your orders are delivered
        </CardTitle>
      </CardHeader>
      <CardContent className="px-6 pb-6 pt-0">
        <p className="text-sm text-muted-foreground">
          We could not check where your orders are being delivered. Reload the page
          to try again.
        </p>
      </CardContent>
    </Card>
  )
  if (!data) return null

  const byType = new Map(data.routes.map(r => [r.credential_type, r]))
  const types = [...new Set(credentialTypes.map(routeKey))].filter(Boolean).sort()
  if (types.length === 0) return null

  const unrouted = types.filter(t => !byType.get(t)?.order_url).length
  const refusing = types.filter(t => byType.get(t)?.last_delivery?.ok === false).length
  const dest = unroutedDestination(data.default_order_url)

  return (
    <Card>
      <CardHeader className="py-4">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Send size={14} />
          <InfoDot title="Where your orders are delivered">
            When someone buys one of your products, we POST the order to an address you
            own. Each credential type can have its own. Anything without one falls back
            to the address set for your whole account, and each row below says where
            that is.
          </InfoDot>
          Where your orders are delivered
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {refusing > 0
            ? `${refusing === 1 ? 'One of your endpoints is' : `${refusing} of your endpoints are`} turning our orders away, so those orders are not reaching you.${unrouted > 0 ? ` A further ${unrouted} have no address set yet.` : ''}`
            : unrouted > 0
              ? `${unrouted} of your ${types.length} credential type${types.length === 1 ? '' : 's'} ${unrouted === 1 ? 'has' : 'have'} no address of ${unrouted === 1 ? 'its' : 'their'} own. ${dest.fate} Add your address and orders reach you instead.`
              : types.every(t => byType.get(t)?.last_delivery?.ok === true)
                ? 'Every credential type is pointed at your own endpoint, and the last order to each one was accepted.'
                : 'Every credential type is pointed at your own endpoint. Some have not taken an order yet, so we cannot confirm delivery for those.'}
        </p>
        {/* This card documented the outbound half and nothing else, so a vendor
            could see where an order is sent and had no way to learn how to
            report the result. Orders then sat open until someone emailed us.
            Static copy: none of it varies by vendor. */}
        <details className="mt-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer text-foreground/80">
            How to send us the result
          </summary>
          <div className="mt-2 space-y-1.5">
            <p>
              Every order we send carries an events_url in its delivery section, of the
              form <span className="font-mono">.../orders/&#123;order_id&#125;/events</span>.
              POST your progress there with your CredPass API key in an X-API-Key header
              and a JSON body of{' '}
              <span className="font-mono">&#123;"status": "...", "occurred_at": "..."&#125;</span>,
              where occurred_at is your own clock in ISO 8601.
            </p>
            <p className="font-mono">
              accepted, in_progress, delayed, completed, failed, cancelled
            </p>
            <p>
              delayed and failed need a reason_code. completed needs
              credential.file_id and credential.owner_user_id, which is what binds the
              credential you delivered back to this order. Until a completed event
              arrives, the order stays open for the person who paid for it.
            </p>
          </div>
        </details>
      </CardHeader>
      <CardContent className="p-0">
        {types.map(type => {
          const route = byType.get(type)
          const configured = !!route?.order_url
          const failing = configured && route?.last_delivery?.ok === false
          // Green is earned, not assumed. It requires a delivery we actually
          // saw succeed. Treating "no record yet" as healthy is what let an
          // endpoint that had refused three consecutive orders show a green
          // tick, because the refusals predated this record existing.
          const live = configured && route?.last_delivery?.ok === true
          const unconfirmed = configured && !failing && !live
          const isEditing = editing === type
          return (
            <div key={type} className="px-6 py-3 border-t border-border">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono font-medium">{displayType(type)}</span>
                    {live && (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                        <CheckCircle2 size={12} />Your endpoint
                      </span>
                    )}
                    {failing && (
                      <span className="inline-flex items-center gap-1 text-xs text-red-500">
                        <XCircle size={12} />Your endpoint is refusing orders
                      </span>
                    )}
                    {unconfirmed && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock size={12} />Your endpoint, no order delivered yet
                      </span>
                    )}
                    {!configured && (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                        <AlertTriangle size={12} />{dest.label}
                      </span>
                    )}
                  </div>
                  {configured ? (
                    <p className="text-xs text-muted-foreground font-mono truncate mt-0.5">
                      {route!.order_url}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-0.5">{dest.fate}</p>
                  )}
                  {failing && (
                    <p className="text-xs text-red-500 mt-1">
                      We sent an order and your endpoint turned it away
                      {route?.last_delivery?.at ? ` on ${new Date(route.last_delivery.at).toLocaleString()}` : ''}.
                      {route?.last_delivery?.detail ? ` It replied: ${route.last_delivery.detail}` : ''}
                      {' '}Until this clears, these orders are answered by Instruxi's test
                      service and do not reach you.
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
                    {configured ? 'Change' : 'Use my endpoint'}
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
                        Orders for <span className="font-mono">{displayType(type)}</span> stop
                        coming to your address. {dest.fate} Anything already sent is
                        unaffected.
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
                    {configured && (
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
      One thing left. Orders for {unrouted.map(displayType).join(', ')} have no
      address of their own. {unroutedDestination(data.default_order_url).fate} Set
      your address under "Where your orders are delivered" below.
    </p>
  )
}
