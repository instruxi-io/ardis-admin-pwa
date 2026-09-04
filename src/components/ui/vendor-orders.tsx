import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, Clock, Inbox, XCircle, AlertTriangle } from 'lucide-react'
import { vendorOrdersApi, type VendorOrder } from '@/lib/ardisMsClient'
import { Card, CardContent, CardHeader, CardTitle } from './card'
import { InfoDot } from './tooltip'

/**
 * A vendor's recent orders.
 *
 * Until this existed a vendor could not see an order at all: the dispatch queue
 * drains on delivery, so there was nothing to list, and the only record that an
 * endpoint had refused an order lived in our logs. That turned every "did our
 * order arrive?" into an email. This answers it on the page.
 *
 * No personal data here on purpose. The form answers stay behind the payload
 * endpoint, which is separately scoped.
 */
export function VendorOrders() {
  const { data, isLoading, isError } = useQuery<VendorOrder[]>({
    queryKey: ['vendor-orders'],
    queryFn: vendorOrdersApi.list,
    retry: false,
  })

  if (isLoading) return null
  // Before the !data guard: on an error `data` is undefined, so testing it
  // first returned null and this card could never render.
  //
  // An error is not the same as "not applicable to you". The panel used to
  // disappear on both, so a vendor whose orders failed to load saw the same
  // screen as one who has no orders panel at all.
  if (isError) return (
    <Card>
      <CardHeader className="py-4">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Inbox size={14} />
          Your recent orders
        </CardTitle>
      </CardHeader>
      <CardContent className="px-6 pb-6 pt-0">
        <p className="text-sm text-muted-foreground">
          Your orders could not be loaded just now. Reload the page to try again.
        </p>
      </CardContent>
    </Card>
  )

  // A tenant admin belongs to no single vendor, so this cannot be scoped for
  // them and the endpoint says so. Nothing useful to render.
  if (!data) return null

  return (
    <Card>
      <CardHeader className="py-4">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Inbox size={14} />
          <InfoDot title="Your recent orders">
            Every order a professional placed with you, and whether it reached your
            endpoint. If one was turned away, the reason your endpoint gave is shown
            here so you can find it in your own logs.
          </InfoDot>
          Your recent orders
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {data.length === 0 && (
          <p className="text-sm text-muted-foreground px-6 py-6">
            No orders here yet. Orders placed from now on appear here with their
            delivery status.
          </p>
        )}
        {data.map(o => {
          // The state is the fact; the error message is only the explanation,
          // and it can be empty. Reading the message alone made an abandoned
          // delivery look identical to one still being retried.
          const failed = o.delivery?.state === 'failed' || !!o.delivery?.last_error
          const delivered = o.delivery?.state === 'delivered'
          // Delivered, but not by them. The standby marks the dispatch
          // delivered and clears the error, so this order used to wear the same
          // green "Reached you" as one their endpoint actually accepted.
          const viaStandby = !!o.delivery?.served_by_standby
          // The platform sent it and has heard nothing back for hours. Shown
          // here because the alternative was a log line nobody reads, which is
          // how ten orders went unanswered for four days.
          const waitingHours = o.waiting_on_you_seconds
            ? Math.floor(o.waiting_on_you_seconds / 3600)
            : 0
          return (
            <div key={o.order_id} className="px-6 py-3 border-t border-border">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-mono">{o.order_id}</span>
                    <span className="text-xs text-muted-foreground">{o.credential_type}</span>
                    {delivered && !failed && !viaStandby && (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                        <CheckCircle2 size={12} />Reached you
                      </span>
                    )}
                    {delivered && viaStandby && (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                        <AlertTriangle size={12} />Your endpoint refused it, our standby fulfilled it
                      </span>
                    )}
                    {viaStandby && o.delivery?.standby_reason && (
                    <p className="text-xs text-amber-600 mt-1">{o.delivery.standby_reason}</p>
                  )}
                  {failed && (
                      <span className="inline-flex items-center gap-1 text-xs text-red-500">
                        <XCircle size={12} />Your endpoint turned it away
                      </span>
                    )}
                    {waitingHours > 0 && (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-600 font-medium">
                        <Clock size={12} />Waiting on you for {waitingHours}h
                      </span>
                    )}
                    {!delivered && !failed && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock size={12} />{o.status}
                      </span>
                    )}
                  </div>
                  {viaStandby && o.delivery?.standby_reason && (
                    <p className="text-xs text-amber-600 mt-1">{o.delivery.standby_reason}</p>
                  )}
                  {failed && (
                    <p className="text-xs text-red-500 mt-1">
                      {o.delivery?.last_error ||
                        'Delivery was abandoned after repeated attempts. No reason was recorded.'}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Placed {new Date(o.placed_at).toLocaleString()}
                    {o.vendor_order_id ? ` · your reference ${o.vendor_order_id}` : ''}
                  </p>
                </div>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
