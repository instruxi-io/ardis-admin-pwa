import { useEffect } from 'react'
import { toast } from 'sonner'

/**
 * Keeps a long-lived portal tab current without asking anyone to hard refresh.
 *
 * There is no service worker here, so a fresh visit always gets the newest
 * build; the only stale thing possible is a tab someone left open. This hook
 * closes that gap: on window focus and every five minutes it re-fetches
 * index.html (no-store) and compares the hashed bundle name against the one
 * this tab loaded. A vendor was told to "hard refresh" to pick up a fix, which
 * is an instruction the software should never need a person to know.
 *
 * When a new build appears: reload immediately if there is no work in flight,
 * otherwise show a persistent toast with a Reload button and let them finish.
 * Pages with unsaved state declare it via `window.__ardisDirty`.
 */
declare global {
  interface Window { __ardisDirty?: boolean }
}

const BUNDLE_RE = /\/assets\/index-[\w-]+\.js/

function currentBundle(): string | null {
  const el = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]')
  return el ? (el.src.match(BUNDLE_RE)?.[0] ?? null) : null
}

export function useSelfUpdate() {
  useEffect(() => {
    const loaded = currentBundle()
    if (!loaded) return // dev server: nothing hashed, nothing to do

    let prompted = false
    const check = async () => {
      try {
        const html = await (await fetch('/', { cache: 'no-store' })).text()
        const served = html.match(BUNDLE_RE)?.[0]
        if (!served || served === loaded || prompted) return
        if (window.__ardisDirty) {
          prompted = true
          toast('The portal has been updated', {
            description: 'Reload to pick it up. Your in-progress edits are why this did not happen automatically.',
            action: { label: 'Reload', onClick: () => location.reload() },
            duration: Infinity,
          })
        } else {
          location.reload()
        }
      } catch { /* offline or transient: the next check tries again */ }
    }

    const onFocus = () => { void check() }
    window.addEventListener('focus', onFocus)
    const timer = setInterval(check, 5 * 60_000)
    return () => { window.removeEventListener('focus', onFocus); clearInterval(timer) }
  }, [])
}
