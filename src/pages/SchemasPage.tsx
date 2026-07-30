import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Upload, CheckCircle2, AlertCircle, Database, FileJson
} from 'lucide-react'
import { OrderFormPreview, CredentialPreview } from '@/components/ui/schema-preview'
import { schemasApi, productsApi, type SchemaIndexEntry, type ProductEntry, type SchemaDriftRecord } from '@/lib/ardisMsClient'
import { suggestGroups } from '@/lib/suggestGroups'
import { exampleFiles } from '@/lib/catalogue/exampleFiles'
import { useAuth } from '@/context/AuthContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PublishConfirmModal } from '@/components/ui/publish-confirm-modal'
import { env } from '@/config/env'
import { PreviewErrorBoundary, SchemaGroup } from '@/components/catalogue/SchemaGroup'
import { PricingMapper } from '@/components/catalogue/PricingMapper'
import { ValidationPanel } from '@/components/catalogue/ValidationPanel'
import { DropZone } from '@/components/catalogue/DropZone'
import { validateBundle } from '@/lib/catalogue/bundleValidation'
import {
  PUBLISH_ORDER, isConflict, deepEqual, nextVersion, skuFor,
  type DroppedFile, type PublishStep,
} from '@/lib/catalogue/publishPlan'
import {
  parseMultipleJsonObjects, parseBundle, kindOf, KIND_LABEL,
  type ViewModelBundle,
} from '@/lib/catalogue/bundleFormat'

// ── Bundle file format (Andy / standard JSON Forms convention) ────────────────
//
// One file, three JSON objects stacked vertically:
//
//   { JSON Schema }    ← data structure + x- metadata fields
//   { UI Schema }      ← layout: ui:order, ui:groups, widget hints
//   { JSON Data }      ← sample payload for preview
//
// Manifest metadata is embedded in the JSON Schema using x- extension fields:
//   x-verifier-id, x-verifier-name, x-credential-type, x-order-type, x-version
//
// Also accepts the legacy single-object format for backwards compatibility.

// ── Multi-JSON parser ─────────────────────────────────────────────────────────


// ── Normalise any import format into a flat bundle object ─────────────────────


export default function SchemasPage({ mode = 'vendor' }: { mode?: 'vendor' | 'platform' }) {
  const isPlatformMode = mode === 'platform'
  // No username here on purpose: it is not a verifier_id and treating it as one
  // is what broke the visibility filter and the starter file.
  const { isDeveloper } = useAuth()
  const queryClient = useQueryClient()

  const [showImport, setShowImport] = useState(false)
  // A product is two files, so the panel holds a set of them rather than one.
  // `edited` is the operator's in-place JSON edit, kept per file so switching
  // between them does not discard changes.
  const [files, setFiles] = useState<DroppedFile[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [publishLog, setPublishLog] = useState<PublishStep[]>([])
  // The whole queue awaiting confirmation in production, not a single bundle.
  const [pendingBundle, setPendingBundle] = useState<{ file: DroppedFile; bundle: ViewModelBundle }[] | null>(null)
  const [publishConfirmed, setPublishConfirmed] = useState(false)
  // Set after publishing a credential schema, to prompt for the product half.
  const [awaitingProduct, setAwaitingProduct] = useState<
    { verifierId: string; credentialType: string; version: string } | null>(null)
  // What happened to the credential schema half of a publish: published, or
  // already published and unchanged. Surfaced so a product-only update does not
  // look like it silently skipped the schema.
  const [schemaOutcome, setSchemaOutcome] = useState<string | null>(null)

  const IS_PROD = env.APP_ENV === 'production'

  // The selected file drives the review panes below. Everything downstream reads
  // activeRaw, so the review is unchanged whether one file was dropped or four.
  const selected = files.find(f => f.id === selectedId) ?? files[0] ?? null
  const activeRaw = selected ? (selected.edited ?? selected.raw) : null
  const bundle: ViewModelBundle | null = activeRaw ? parseBundle(activeRaw) : null

  // Each dropped file with its parse and validation result, in the order they
  // will be published.
  const queue = files
    .map(f => {
      const parsed = parseBundle(f.edited ?? f.raw)
      return { file: f, bundle: parsed, validation: parsed ? validateBundle(parsed) : null }
    })
    .sort((a, b) =>
      (PUBLISH_ORDER[a.bundle ? kindOf(a.bundle) : 'product'] ?? 9) -
      (PUBLISH_ORDER[b.bundle ? kindOf(b.bundle) : 'product'] ?? 9))

  const queueReady = queue.length > 0 && queue.every(q => q.validation?.pass)

  const setSelectedRaw = (text: string) => {
    if (!selected) return
    setFiles(prev => prev.map(f => (f.id === selected.id ? { ...f, edited: text } : f)))
    setPublishConfirmed(false)
  }

  // Writes generated ui:groups into the file on screen. The vendor edits titles
  // and regroups from there, which is a different job from being told the key
  // exists and left to place it — the RJSF playground neither renders ui:groups
  // nor offers a way to author it, so there is nowhere else to learn it.
  const applySuggestedGroups = () => {
    if (!selected || !bundle) return
    const objects = parseMultipleJsonObjects(selected.edited ?? selected.raw)
    if (objects.length !== 3) return
    const groups = suggestGroups(
      objects[0] as Record<string, unknown>,
      objects[1] as Record<string, unknown>,
    )
    if (groups.length < 2) {
      toast.error('Not enough distinct fields to split into steps')
      return
    }
    objects[1] = { ...(objects[1] as Record<string, unknown>), 'ui:groups': groups }
    setSelectedRaw(objects.map(o => JSON.stringify(o, null, 2)).join('\n'))
    toast.success(`Split into ${groups.length} steps — edit the titles below`)
  }

  const addFiles = (dropped: { name: string; raw: string }[]) => {
    if (dropped.length === 0) return
    const entries: DroppedFile[] = dropped.map((d, i) => ({
      // Names can repeat across drops; the index keeps ids unique without a uuid.
      id: `${d.name}-${files.length + i}-${d.raw.length}`,
      name: d.name,
      raw: d.raw,
      edited: null,
    }))
    setFiles(prev => [...prev, ...entries])
    setSelectedId(prev => prev ?? entries[0].id)
    setPublishConfirmed(false)
    setPublishLog([])
  }

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id))
    if (selectedId === id) setSelectedId(null)
    setPublishConfirmed(false)
  }

  const validation = bundle ? validateBundle(bundle) : null

  // The bundle's own verifier_id is authoritative. This used to be overwritten
  // with the developer's username, from when verifier_id was the account username
  // by convention. It no longer is: a verifier_id lives in the metadata of the
  // Enforcer group an account belongs to, and the server authorises against that
  // group membership. Usernames and verifier ids routinely differ (ardis-vp vs
  // ardis), so overwriting produced a bundle the server would reject, or worse
  // publish under the wrong verifier.
  //
  // Sending the bundle as authored means the server's group-membership check is
  // the single place authorisation is decided, and a mismatch surfaces as an
  // explicit 403 rather than silently rewritten data.
  const effectiveBundle = bundle

  const { data: schemas = [], isLoading: schemasLoading } = useQuery({
    queryKey: ['schemas'],
    queryFn: schemasApi.list,
  })

  const { data: products = [], isLoading: productsLoading } = useQuery({
    queryKey: ['products'],
    queryFn: productsApi.list,
  })

  // Reported by the app when it renders a credential. Not gating anything, so a
  // failure here must not blank the page — an empty list reads as "no drift",
  // which is also the healthy state.
  const { data: drift = [] } = useQuery({
    queryKey: ['schema-drift'],
    queryFn: schemasApi.drift,
    retry: false,
  })

  const driftByVersion = drift.reduce<Record<string, SchemaDriftRecord>>((acc, d) => {
    acc[`${d.verifier_id}/${d.credential_type}/${d.version}`] = d
    return acc
  }, {})

  const isLoading = schemasLoading || productsLoading

  // Index products by verifier_id/credential_type for fast lookup
  const productIndex = products.reduce<Record<string, ProductEntry>>((acc, p) => {
    // Keyed by the product's real identity. This was verifier_id/credential_type,
    // which collides the moment a vendor sells two products of the same type — the
    // second overwrote the first, so stripe_product_id was handed to the wrong
    // product and publishing edited someone else's entry.
    const sku = p.sku?.trim() || skuFor({ name: p.name })
    if (p.verifier_id && sku) {
      acc[`${p.verifier_id}/${sku}`] = p
    }
    return acc
  }, {})

  // Products that render with a given credential schema, keyed
  // verifier_id/credential_type.
  //
  // This is a many-to-one relation and the list has to treat it as one: since the
  // product and credential schema became separate files, ardis/license/v2 is used
  // by both license-verification and provider-background-check. The list used to
  // read productIndex — keyed by SKU — with a credential_type key, so it matched
  // only when a product's sku happened to equal its credential type and otherwise
  // showed "No Stripe product" for a product that existed.
  const productsByType = products.reduce<Record<string, ProductEntry[]>>((acc, p) => {
    if (!p.verifier_id || !p.credential_type) return acc
    const key = `${p.verifier_id}/${p.credential_type}`
    ;(acc[key] ??= []).push(p)
    return acc
  }, {})

  // Products naming a credential_type that has no published schema. They would
  // otherwise be invisible here — the list is grouped by schema, so a product
  // without one has no group to appear under.

  // Publishes one file. Extracted from the mutation so a single drop and a whole
  // queue run through identical code — a two-file product must not take a
  // different path from a one-file one.
  const publishBundle = async (b: ViewModelBundle) => {
    {
      const kind = kindOf(b)
      // Authored value, not the username — see effectiveBundle above.
      const verifierId     = b.verifier_id as string
      const credentialType = b.credential_type as string
      const version        = (b.version as string) || 'v1'

      // 1. Publish the credential schema.
      //
      // Credential schemas are immutable per version, so re-publishing an
      // existing version returns 409. That is expected whenever someone is
      // editing only the product side — a price, the name, the order form — and
      // it must NOT abort the publish, or a price change becomes impossible
      // without minting a credential schema version nobody asked for.
      //
      // But a 409 can mean two different things, and they need opposite
      // outcomes: the schema is unchanged (fine, carry on to the product), or
      // the schema was edited and the version wasn't bumped (a real error, and
      // silently proceeding would leave the bundle and the published schema
      // disagreeing). So on 409 we fetch what is published and compare.
      const desiredSchema = {
        data_schema: (b.data_schema as Record<string, unknown>),
        ui_schema:   (b.ui_schema   as Record<string, unknown>) ?? {},
        sample_data: (b.data        as Record<string, unknown>) ?? undefined,
      }

      const publishCredentialSchema = async () => {
        try {
          await schemasApi.publish({
            verifier_id:     verifierId,
            credential_type: credentialType,
            version,
            ...desiredSchema,
          })
          setSchemaOutcome(`Credential schema ${credentialType}/${version} published.`)
        } catch (err) {
          if (!isConflict(err)) throw err

          const published = await schemasApi.get(verifierId, credentialType, version)
          const changed =
            !deepEqual(published.data_schema, desiredSchema.data_schema) ||
            !deepEqual(published.ui_schema ?? {}, desiredSchema.ui_schema)

          if (changed) {
            throw new Error(
              `Credential schema ${credentialType}/${version} is already published and ` +
              `cannot be changed. Your file's credential schema differs from it — ` +
              `bump x-version to publish the new shape (e.g. ${nextVersion(version)}).`,
              { cause: err },
            )
          }
          setSchemaOutcome(
            `Credential schema ${credentialType}/${version} is already published and unchanged — ` +
            `nothing to do.`
          )
        }
      }

      // Publish the product to Stripe. Pass the existing Stripe product ID if one
      // already exists for this verifier/sku so ardis-ms updates it instead of
      // creating a duplicate.
      //
      // pinSchemaVersion is only true for a legacy combined bundle, where the
      // product and the credential schema were published together and the product
      // pointed at that exact version. A split product names a credential_type and
      // no version: it keeps working when a new schema version is published,
      // which is the whole reason the halves were separated.
      const publishProduct = async (pinSchemaVersion: boolean) => {
        const existingProduct = productIndex[`${verifierId}/${skuFor(b)}`]
        await productsApi.publish({
          stripe_product_id: existingProduct?.id,
          name:              b.name as string,
          description:       b.description as string | undefined,
          verifier_id:       verifierId,
          sku:               skuFor(b),
          verifier_name:     (b.verifier_name as string) || verifierId,
          order_type:        (b.order_type as string) ?? 'license',
          credential_type:   credentialType,
          active:            true,
          order_schema:      b.order_schema as Record<string, unknown>,
          order_ui_schema:   (b.order_ui_schema as Record<string, unknown>) ?? {},
          ...(pinSchemaVersion ? {
            version,
            display_schema_path: `display-schemas/${verifierId}/${credentialType}/${version}/schema.json`,
          } : {}),
          x_pricing:      b['x-pricing'] ?? b['x_pricing'],
          product_role:   (b['x-product-role'] as string) ?? '',
          price_one_time: (b['x-price-one-time'] as number) ?? 0,
          price_currency: (b['x-price-currency'] as string) ?? '',
        })
      }

      if (kind === 'credential-schema') {
        await publishCredentialSchema()
        return
      }
      if (kind === 'product') {
        // No schema publish here. The server refuses a product whose
        // credential_type has no published schema, so the ordering is enforced
        // there rather than guessed at from this side.
        await publishProduct(false)
        return
      }
      await publishCredentialSchema()
      await publishProduct(true)
    }
  }

  const publishMutation = useMutation({
    // Publishes every dropped file in dependency order. Stops at the first
    // failure: a product almost always depends on a schema earlier in the queue,
    // so carrying on would pile a second, misleading error on top of the real one.
    mutationFn: async (items: { file: DroppedFile; bundle: ViewModelBundle }[]) => {
      setPublishLog(items.map(i => ({ id: i.file.id, name: i.file.name, status: 'pending' })))
      for (let i = 0; i < items.length; i++) {
        const { file, bundle: b } = items[i]
        setPublishLog(prev => prev.map(s => s.id === file.id ? { ...s, status: 'running' } : s))
        try {
          await publishBundle(b)
          setPublishLog(prev => prev.map(s => s.id === file.id
            ? { ...s, status: 'done', detail: KIND_LABEL[kindOf(b)] } : s))
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Publish failed'
          setPublishLog(prev => prev.map(s =>
            s.id === file.id      ? { ...s, status: 'failed',  detail: msg } :
            s.status === 'pending' ? { ...s, status: 'skipped', detail: 'not attempted' } : s))
          throw new Error(`${file.name}: ${msg}`, { cause: err })
        }
      }
      return items
    },
    onMutate: () => setSchemaOutcome(null),
    onSuccess: (items) => {
      queryClient.invalidateQueries({ queryKey: ['schemas'] })
      queryClient.invalidateQueries({ queryKey: ['products'] })

      const kinds = items.map(i => kindOf(i.bundle))
      const schemaCount  = kinds.filter(k => k === 'credential-schema').length
      const productCount = kinds.filter(k => k !== 'credential-schema').length

      if (items.length > 1) {
        toast.success(`Published ${[
          schemaCount  ? `${schemaCount} credential schema${schemaCount === 1 ? '' : 's'}` : '',
          productCount ? `${productCount} product${productCount === 1 ? '' : 's'}` : '',
        ].filter(Boolean).join(' and ')}`)
      } else {
        // Single file: say which half changed. "Published" alone is ambiguous when
        // the schema was left alone because its version already exists.
        toast.success(
          kinds[0] === 'credential-schema' ? (schemaOutcome ?? 'Credential schema published')
          : kinds[0] === 'product'         ? 'Product published to Stripe'
          : schemaOutcome                  ? `Product published. ${schemaOutcome}`
          :                                  'Product and credential schema published')
      }

      // A schema published with no product alongside it is half a pair. Hold the
      // panel open and name what is missing, rather than clearing the screen and
      // leaving the operator to remember that a schema alone sells nothing.
      if (productCount === 0 && schemaCount > 0) {
        const last = items[items.length - 1].bundle
        setAwaitingProduct({
          verifierId:     last.verifier_id as string,
          credentialType: last.credential_type as string,
          version:        (last.version as string) || 'v1',
        })
        resetImport(true)
        return
      }
      setAwaitingProduct(null)
      resetImport()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Publish failed'),
  })

  // keepOpen leaves the import panel up for the second half of a pair. Closing it
  // after publishing a credential schema hid the fact that a product still had to
  // be uploaded, and the two files are almost always uploaded back to back.
  const resetImport = (keepOpen = false) => {
    setShowImport(keepOpen)
    setFiles([])
    setSelectedId(null)
    setPendingBundle(null)
    setPublishConfirmed(false)
  }

  // Everything valid in the queue, in the order it will be published.
  const publishable = queue
    .filter(q => q.bundle && q.validation?.pass)
    .map(q => ({ file: q.file, bundle: q.bundle as ViewModelBundle }))

  const handlePublish = () => {
    if (publishable.length === 0) return
    if (!publishConfirmed) return
    // Developers may never publish platform-role products. Checked across the
    // whole queue, not just the file on screen — the offending one may not be
    // the one being reviewed.
    const platform = publishable.find(p => p.bundle['x-product-role'] === 'platform')
    if (isDeveloper && platform) {
      toast.error(`${platform.file.name}: platform subscription products may only be published by a tenant admin.`)
      return
    }
    if (IS_PROD) setPendingBundle(publishable)
    else { publishMutation.mutate(publishable); setPublishConfirmed(false) }
  }

  // ── Download helpers ─────────────────────────────────────────────────────

  // A verifier_id the caller is known to own. Everything the server returned is
  // already scoped to their group memberships, so any id in it is authoritative —
  // unlike the account username, which routinely differs from the verifier_id and
  // put a value in the starter file that the server would reject with a 403.
  const ownVerifierId =
    schemas[0]?.verifier_id ?? products.find(p => p.verifier_id)?.verifier_id ?? ''

  // Loads the worked example into the panel rather than downloading it: a new
  // vendor got a file on disk and an empty screen, when what they needed was to
  // see a valid example rendered. Definition lives in lib so a test can assert on
  // the exact thing they are handed.
  const loadExamplePair = () => {
    setFiles(exampleFiles(ownVerifierId).map(f => ({ ...f, edited: null })))
    setSelectedId('example-credential')
    setPublishLog([])
    setPublishConfirmed(false)
    setShowImport(true)
  }

  const downloadPublishedBundle = async (verifierId: string, credentialType: string, version: string, name: string) => {
    try {
      const content = await schemasApi.get(verifierId, credentialType, version)
      const bundle = [
        {
          "$id": `${verifierId}/${credentialType}/${version}`,
          "title": name,
          "x-verifier-id": verifierId,
          "x-credential-type": credentialType,
          "x-version": version,
          "type": "object",
          "properties": {},
          ...(content.data_schema ?? {}),
        },
        content.ui_schema ?? {},
        {}
      ]
      const text = bundle.map(o => JSON.stringify(o, null, 2)).join('\n')
      const blob = new Blob([text], { type: 'application/json' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url
      a.download = `${verifierId}_${credentialType}_${version}.bundle.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Failed to download schema')
    }
  }

  // Load a published bundle back into the import wizard for creating a new version.
  const loadForNewVersion = async (verifierId: string, credentialType: string, version: string, name: string) => {
    try {
      const content = await schemasApi.get(verifierId, credentialType, version)
      const product = productIndex[`${verifierId}/${credentialType}`]
      // Reconstruct the full bundle JSON with all x- fields from the product
      const obj1: Record<string, unknown> = {
        '$id':             `${verifierId}/${credentialType}/${version}`,
        'title':           name,
        'description':     product?.description ?? '',
        'x-verifier-id':   verifierId,
        'x-verifier-name': product?.verifier_name ?? verifierId,
        'x-credential-type': credentialType,
        'x-order-type':    product?.order_type ?? 'license',
        'x-version':       version,
        'type':            'object',
        'properties':      content.data_schema?.['properties'] ?? {},
        'x-data-schema':   content.data_schema ?? {},
        'x-data-ui-schema': content.ui_schema ?? {},
      }
      if (product?.x_pricing) obj1['x-pricing'] = product.x_pricing
      if (product?.price_one_time) obj1['x-price-one-time'] = product.price_one_time
      if (product?.product_role) obj1['x-product-role'] = product.product_role

      const bundle = [obj1, content.ui_schema ?? {}, {}]
      const text = bundle.map(o => JSON.stringify(o, null, 2)).join('\n')

      setFiles([{ id: `new-version-${name}`, name: `${name} (new version)`, raw: text, edited: null }])
      setSelectedId(null)
      setPublishLog([])
      setShowImport(true)
      toast.success(`Loaded ${name} — review and publish to create a new version`)
    } catch {
      toast.error('Failed to load schema for editing')
    }
  }

  // product_role lives on the product, not the schema index entry.
  // Use productIndex to check it when filtering schemas.
  const schemaProductRole = (s: typeof schemas[0]) => {
    const key = `${s.verifier_id}/${s.credential_type}`
    // Any product on this schema being the platform gate makes the schema
    // platform-scoped; in practice the gate is the only product on its type.
    return (productsByType[key] ?? []).some(p => p.product_role === 'platform')
      ? 'platform'
      : ''
  }

  // No verifier_id filter here. ListSchemas already scopes the response to the
  // verifier ids of the groups the caller belongs to, so the server is the
  // boundary and anything that arrives is theirs to see.
  //
  // This used to also require s.verifier_id === username, which is the same
  // mistake the publish path was fixed for: a verifier_id lives in group
  // metadata and routinely differs from the account name (ardis-vp vs ardis).
  // A vendor whose names differ published successfully and then saw an empty
  // list — indistinguishable from having lost the work. It only looked correct
  // because the developer test account happens to have username == verifier_id.
  const visibleSchemas = isPlatformMode
    ? schemas.filter(s => schemaProductRole(s) === 'platform')
    : schemas.filter(s => schemaProductRole(s) !== 'platform')

  // Products scoped the same way the schemas are. The counts and the orphan list
  // were computed from the unfiltered sets while the groups below were filtered,
  // so the Platform Subscription page reported "0 credential types · 34 schema
  // versions" — two numbers from two different populations — and listed a vendor1
  // product as an orphan on a page that has nothing to do with vendors.
  const visibleProducts = isPlatformMode
    ? products.filter(p => p.product_role === 'platform')
    : products.filter(p => p.product_role !== 'platform')

  const visibleProductsByType = visibleProducts.reduce<Record<string, ProductEntry[]>>((acc, p) => {
    if (!p.verifier_id || !p.credential_type) return acc
    ;(acc[`${p.verifier_id}/${p.credential_type}`] ??= []).push(p)
    return acc
  }, {})

  const publishedTypes = new Set(
    visibleSchemas.map(s => `${s.verifier_id}/${s.credential_type}`))
  const orphanProducts = visibleProducts.filter(p =>
    p.verifier_id && !publishedTypes.has(`${p.verifier_id}/${p.credential_type ?? ''}`))

  const grouped = visibleSchemas.reduce<Record<string, typeof schemas>>((acc, s) => {
    const key = `${s.verifier_id}/${s.credential_type}`
    if (!acc[key]) acc[key] = []
    acc[key].push(s)
    return acc
  }, {})

  // The index appends on every publish rather than upserting, so one version can
  // appear many times: ardis/license/v1 is in there seven times. Left as-is a
  // group reports "+6 prior" for a single immutable version, which reads as six
  // superseded schemas that do not exist. Collapse to one entry per version,
  // keeping the most recent publish, since that is the one in storage.
  for (const key of Object.keys(grouped)) {
    const newestByVersion = new Map<string, SchemaIndexEntry>()
    for (const s of grouped[key]) {
      const prev = newestByVersion.get(s.version)
      if (!prev || (s.published_at ?? '') > (prev.published_at ?? '')) {
        newestByVersion.set(s.version, s)
      }
    }
    grouped[key] = [...newestByVersion.values()]
  }

  // Whether the file on screen has its other half already published, answered
  // before the publish rather than by a server error after it. The schema list is
  // loaded anyway, so this costs nothing and is the difference between "publish
  // and find out" and knowing what will happen.
  //
  // Deliberately advisory, not a gate: the server decides, and this can be stale
  // if someone else published a second ago.
  const pairing = (() => {
    if (!effectiveBundle) return null
    const kind = kindOf(effectiveBundle)
    const verifierId = effectiveBundle.verifier_id as string
    const credentialType = effectiveBundle.credential_type as string
    const key = `${verifierId}/${credentialType}`

    if (kind === 'product') {
      const liveVersions = (grouped[key] ?? []).map(s => s.version)
      return liveVersions.length > 0
        ? { ok: true, text: `Renders with ${key} — published (${liveVersions.join(', ')}).` }
        : { ok: false, text: `No credential schema published for ${key}. Publish that file first, or this will be refused.` }
    }

    if (kind === 'credential-schema') {
      const version = (effectiveBundle.version as string) || 'v1'
      if ((grouped[key] ?? []).some(s => s.version === version)) {
        return { ok: false, text: `${key}/${version} is already published. If your file differs, bump x-version to ${nextVersion(version)}.` }
      }
      const users = productsByType[key] ?? []
      return {
        ok: true,
        text: users.length > 0
          ? `Used by ${users.length} existing product${users.length === 1 ? '' : 's'}: ${users.map(p => p.name).join(', ')}.`
          : 'New credential type. Upload its product file next to make it orderable.',
      }
    }
    return null
  })()

  return (
    <>
      <PublishConfirmModal
        open={!!pendingBundle && pendingBundle.length > 0}
        action="Publish"
        confirmText={pendingBundle?.[0]
          ? `${pendingBundle[0].bundle.verifier_id}/${pendingBundle[0].bundle.credential_type}`
          : ''}
        description={pendingBundle
          ? pendingBundle.length === 1
            ? `Publishing ${KIND_LABEL[kindOf(pendingBundle[0].bundle)].toLowerCase()} "${pendingBundle[0].bundle.name}".`
            : `Publishing ${pendingBundle.length} files: ${pendingBundle.map(p => p.file.name).join(', ')}.`
          : ''}
        onConfirm={() => { if (pendingBundle) { publishMutation.mutate(pendingBundle); setPendingBundle(null); setPublishConfirmed(false) } }}
        onCancel={() => setPendingBundle(null)}
      />

      <div className="space-y-6 animate-fade-in">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">
              {isPlatformMode ? 'Platform Subscription' : 'Catalogue'}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {isPlatformMode
                ? 'Manage the platform subscription that gates vault and catalogue access for all professionals. Tenant admin only.'
                : 'Credential schemas and the products that render with them. Schemas are versioned and immutable; products are edited in place.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={loadExamplePair}>
              <FileJson size={14} className="mr-1.5" />Load example
            </Button>
            <Button onClick={() => showImport ? resetImport() : setShowImport(true)} size="sm">
              {showImport ? 'Cancel' : <><Upload size={14} className="mr-1.5" />Import</>}
            </Button>
          </div>
        </div>

        {/* Import flow */}
        {showImport && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileJson size={14} />
                New product
              </CardTitle>
              {/* This described the old combined bundle — "a single JSON file" —
                  which is now the opposite of what the operator has to do, on the
                  one screen where they have not yet dropped a file and so have no
                  other signal to go on. */}
              <div className="text-xs text-muted-foreground space-y-1">
                <p>
                  A product takes two files. Upload the{' '}
                  <span className="font-medium text-foreground/80">credential schema</span> first — what the
                  vendor returns, versioned and immutable — then the{' '}
                  <span className="font-medium text-foreground/80">product</span>, which carries the order
                  form and pricing.
                </p>
                <p>
                  Order matters: a product is refused until the credential schema it renders with exists.
                  Each file declares which it is via <span className="font-mono">x-publishes</span>, and
                  you will be told what it does before anything is published.
                </p>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">

              {/* Carried over from the schema that was just published: a schema on
                  its own is not orderable, and this is the moment that fact is
                  actionable. */}
              {awaitingProduct && files.length === 0 && (
                <div className="flex items-start justify-between gap-4 p-3 rounded-lg border border-emerald-500/25 bg-emerald-500/5">
                  <div className="flex items-start gap-2 min-w-0">
                    <CheckCircle2 size={14} className="text-emerald-500 mt-0.5 shrink-0" />
                    <div className="space-y-0.5 min-w-0">
                      <p className="text-xs font-semibold text-emerald-600">
                        Published {awaitingProduct.verifierId}/{awaitingProduct.credentialType}/{awaitingProduct.version}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Nothing sells it yet. Drop the product file whose{' '}
                        <span className="font-mono">x-credential-type</span> is{' '}
                        <span className="font-mono">{awaitingProduct.credentialType}</span> to make it orderable.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAwaitingProduct(null)}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  >
                    Later
                  </button>
                </div>
              )}

              {/* Step 1 — Upload */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Files</p>
                <DropZone count={files.length} onFiles={addFiles} />

                {/* The batch, in the order it will be published. Schemas sort
                    ahead of products because the server refuses a product whose
                    credential type has no schema — so the operator never has to
                    sequence the uploads themselves. */}
                {files.length > 0 && (
                  <div className="rounded-lg border border-border divide-y divide-border mt-2">
                    {queue.map((q, i) => {
                      const step = publishLog.find(s => s.id === q.file.id)
                      const isSel = selected?.id === q.file.id
                      const kind = q.bundle ? kindOf(q.bundle) : null
                      return (
                        <div
                          key={q.file.id}
                          onClick={() => setSelectedId(q.file.id)}
                          className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors
                            ${isSel ? 'bg-primary/5' : 'hover:bg-muted/30'}`}
                        >
                          <span className="font-mono text-[11px] text-muted-foreground w-4 shrink-0">{i + 1}</span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm truncate">
                              {q.bundle ? (q.bundle.name as string) || q.file.name : q.file.name}
                            </p>
                            <p className="text-[11px] text-muted-foreground font-mono truncate">
                              {kind
                                ? `${q.bundle!.verifier_id}/${q.bundle!.credential_type}${
                                    kind === 'credential-schema' ? `/${(q.bundle!.version as string) || 'v1'}` : ''}`
                                : 'could not be parsed'}
                            </p>
                          </div>
                          {kind && (
                            <Badge variant="secondary" className="text-[10px] font-mono shrink-0">
                              {kind === 'credential-schema' ? 'schema' : kind === 'product' ? 'product' : 'bundle'}
                            </Badge>
                          )}
                          {step
                            ? <Badge variant="outline" className={`text-[10px] shrink-0 ${
                                step.status === 'done'    ? 'border-emerald-500/40 text-emerald-600' :
                                step.status === 'failed'  ? 'border-destructive/40 text-destructive' :
                                step.status === 'running' ? 'border-primary/40 text-primary' :
                                                            'border-border text-muted-foreground'}`}>
                                {step.status}
                              </Badge>
                            : <Badge variant="outline" className={`text-[10px] shrink-0 ${
                                q.validation?.pass ? 'border-emerald-500/40 text-emerald-600'
                                                   : 'border-destructive/40 text-destructive'}`}>
                                {q.validation?.pass ? 'valid' : 'invalid'}
                              </Badge>}
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); removeFile(q.file.id) }}
                            className="text-xs text-muted-foreground hover:text-destructive transition-colors shrink-0"
                            title="Remove from this batch"
                          >
                            &times;
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}

                {files.length > 1 && (
                  <p className="text-[11px] text-muted-foreground">
                    Publishing in this order. {selected ? <>Reviewing <span className="font-mono">{selected.name}</span> below — click another to switch.</> : null}
                  </p>
                )}

                {/* Failures name the file, and anything after the failure is left
                    unattempted rather than piling a dependent error on top. */}
                {publishLog.some(s => s.status === 'failed' || s.status === 'skipped') && (
                  <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 space-y-1">
                    {publishLog.filter(s => s.detail && s.status !== 'done').map(s => (
                      <p key={s.id} className="text-xs text-destructive">
                        <span className="font-mono">{s.name}</span> — {s.detail}
                      </p>
                    ))}
                  </div>
                )}
              </div>

              {/* Raw JSON editor — always shown after upload */}
              {selected && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      JSON &middot; <span className="font-mono normal-case">{selected.name}</span>
                    </p>
                    {selected.edited && selected.edited !== selected.raw && (
                      <button
                        type="button"
                        onClick={() => {
                          setFiles(prev => prev.map(f => f.id === selected.id ? { ...f, edited: null } : f))
                          setPublishConfirmed(false)
                        }}
                        className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                      >
                        Reset to original
                      </button>
                    )}
                  </div>
                  <textarea
                    className="w-full h-64 font-mono text-xs bg-muted/20 border border-border rounded-lg p-3 text-foreground resize-y focus:outline-none focus:ring-1 focus:ring-ring"
                    value={selected.edited ?? selected.raw}
                    onChange={e => setSelectedRaw(e.target.value)}
                    spellCheck={false}
                  />
                  <p className="text-[11px] text-muted-foreground">Edit directly above — validation and preview update automatically.</p>
                </div>
              )}

              {/* Step 2 — Preview (always visible as soon as bundle parses) */}
              {bundle && effectiveBundle && (
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Preview</p>

                  {/* What this file publishes, stated before anything else: the
                      two halves have different rules, and a credential schema
                      cannot be taken back once published. */}
                  <div className="flex items-center gap-2 p-3 bg-muted/20 rounded-lg border border-border text-xs">
                    <span className="text-muted-foreground/60 uppercase text-[10px] tracking-wide">Publishes</span>
                    <span className="font-mono font-semibold text-primary">{KIND_LABEL[kindOf(effectiveBundle)]}</span>
                    {kindOf(effectiveBundle) === 'bundle' && (
                      <span className="text-muted-foreground">
                        — no x-publishes, so this is read as the older combined format
                      </span>
                    )}
                  </div>

                  {/* Where this file sits relative to what is already published,
                      before publishing rather than after it fails. */}
                  {pairing && (
                    <div className={`flex items-start gap-2 p-3 rounded-lg border text-xs ${pairing.ok
                      ? 'border-emerald-500/25 bg-emerald-500/5 text-emerald-600'
                      : 'border-amber-500/25 bg-amber-500/5 text-amber-600'}`}>
                      {pairing.ok
                        ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                        : <AlertCircle size={14} className="mt-0.5 shrink-0" />}
                      <span>{pairing.text}</span>
                    </div>
                  )}

                  {/* Summary */}
                  <div className="grid grid-cols-4 gap-3 p-3 bg-muted/20 rounded-lg border border-border text-xs">
                    <div>
                      <span className="text-muted-foreground/60 uppercase text-[10px] tracking-wide">Name</span>
                      <p className="font-medium mt-0.5 truncate">{effectiveBundle.name as string}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground/60 uppercase text-[10px] tracking-wide">Verifier ID</span>
                      <p className="font-mono mt-0.5 text-primary">{effectiveBundle.verifier_id as string}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground/60 uppercase text-[10px] tracking-wide">Credential Type</span>
                      <p className="font-mono mt-0.5 text-primary">{effectiveBundle.credential_type as string}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground/60 uppercase text-[10px] tracking-wide">Version</span>
                      <p className="font-mono mt-0.5 text-primary">
                        {kindOf(effectiveBundle) === 'product'
                          ? '— products are mutable'
                          : ((effectiveBundle.version as string) || 'v1')}
                      </p>
                    </div>
                  </div>

                  {/* A vendor has no way to discover ui:groups: the RJSF
                      playground ignores it and offers nothing to author it with,
                      so a flat form is the only thing they can produce there.
                      Offered rather than applied — plenty of products are
                      correctly a single page. */}
                  {kindOf(effectiveBundle) === 'product' &&
                    (() => {
                      const ui = (effectiveBundle.order_ui_schema as Record<string, unknown>) ?? {}
                      const existing = Array.isArray(ui['ui:groups']) ? (ui['ui:groups'] as unknown[]).length : 0
                      if (existing >= 2) return null
                      const would = suggestGroups(
                        (effectiveBundle.order_schema as Record<string, unknown>) ?? {},
                        ui,
                      )
                      if (would.length < 2) return null
                      return (
                        <div className="flex items-start justify-between gap-4 p-3 rounded-lg border border-border bg-muted/20">
                          <div className="min-w-0">
                            <p className="text-xs font-medium">This renders as one long page</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              It can be {would.length} steps instead: {would.map(g => g.title).join(' · ')}.
                              Titles and grouping are yours to edit afterwards.
                            </p>
                          </div>
                          <Button size="sm" variant="outline" onClick={applySuggestedGroups} className="shrink-0">
                            Split into steps
                          </Button>
                        </div>
                      )
                    })()}

                  {/* Preview only the half this file actually carries. Rendering a
                      credential pane for a product file previewed the order form
                      as if it were the credential, which is exactly the confusion
                      the split exists to remove. */}
                  <div className={`grid ${kindOf(effectiveBundle) === 'bundle' ? 'grid-cols-2' : 'grid-cols-1'} gap-6 py-6 px-4 bg-muted/20 rounded-xl border border-border overflow-x-auto`}>
                    {kindOf(effectiveBundle) !== 'credential-schema' && (
                      <PreviewErrorBoundary label="Order form">
                        <OrderFormPreview
                          schema={(effectiveBundle.order_schema as Record<string, unknown>) ?? {}}
                          uiSchema={(effectiveBundle.order_ui_schema as Record<string, unknown>) ?? {}}
                        />
                      </PreviewErrorBoundary>
                    )}
                    {kindOf(effectiveBundle) !== 'product' && (
                      <PreviewErrorBoundary label="Credential">
                        <CredentialPreview
                          schema={(effectiveBundle.data_schema as Record<string, unknown>) ?? {}}
                          uiSchema={(effectiveBundle.ui_schema as Record<string, unknown>) ?? {}}
                          data={(effectiveBundle.data as Record<string, unknown>) ?? {}}
                          verifierName={effectiveBundle.verifier_name as string}
                          credentialType={effectiveBundle.credential_type as string}
                        />
                      </PreviewErrorBoundary>
                    )}
                  </div>
                </div>
              )}

              {/* Step 3 — Validate */}
              {bundle && validation && (
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Checks</p>
                  <ValidationPanel result={validation} />
                  {!validation.pass && (
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                      <AlertCircle size={14} className="text-amber-500 mt-0.5 shrink-0" />
                      <p className="text-xs text-amber-600">
                        Fix the issues above before publishing. Edit the JSON directly or upload a corrected file.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Step 4 — Stripe Pricing (auto-created on publish). A credential
                  schema has no pricing: it is not a thing anyone buys. */}
              {validation?.pass && effectiveBundle && kindOf(effectiveBundle) !== 'credential-schema' && (
                <PricingMapper bundle={effectiveBundle} />
              )}

              {/* Step 5 — Publish gate. Gated on the whole batch: a valid file on
                  screen with an invalid sibling must not look ready to publish. */}
              {queue.length > 0 && queueReady && effectiveBundle && (
                <div className="space-y-4 pt-2 border-t border-border">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Publish</p>

                  {/* Confirmation details */}
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
                    <div className="flex items-start gap-2">
                      <AlertCircle size={14} className="text-amber-500 mt-0.5 shrink-0" />
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-amber-600">Review before publishing</p>
                        <p className="text-xs text-muted-foreground">
                          {publishable.length > 1
                            ? `Publishing ${publishable.length} files in order: credential schemas first, then the products that render with them. Schema versions are immutable once published, and a changed price archives the old one.`
                            : kindOf(effectiveBundle) === 'credential-schema'
                            ? 'This publishes a credential schema. A published version is immutable — correcting it means publishing a new version, and credentials already issued keep rendering with this one.'
                            : kindOf(effectiveBundle) === 'product'
                            ? 'This creates or updates the product in Stripe. Prices are immutable, so a changed amount archives the old price and creates a new one.'
                            : 'This creates or updates the product and its credential schema. A published schema version cannot be edited afterwards.'}
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3 text-xs">
                      <div className="bg-background/60 rounded p-2">
                        <span className="text-muted-foreground/60 uppercase text-[10px] tracking-wide block">Verifier ID</span>
                        <span className="font-mono font-semibold text-foreground">{effectiveBundle.verifier_id as string}</span>
                      </div>
                      {kindOf(effectiveBundle) !== 'product' && (
                        <div className="bg-background/60 rounded p-2">
                          <span className="text-muted-foreground/60 uppercase text-[10px] tracking-wide block">Schema</span>
                          <span className="font-mono font-semibold text-foreground">{effectiveBundle.credential_type as string}/{(effectiveBundle.version as string) || 'v1'}</span>
                        </div>
                      )}
                      {kindOf(effectiveBundle) !== 'credential-schema' && (
                        <div className="bg-background/60 rounded p-2">
                          <span className="text-muted-foreground/60 uppercase text-[10px] tracking-wide block">Product</span>
                          <span className="font-mono font-semibold text-foreground truncate block">{effectiveBundle.name as string}</span>
                        </div>
                      )}
                      {kindOf(effectiveBundle) === 'product' && (
                        <div className="bg-background/60 rounded p-2">
                          <span className="text-muted-foreground/60 uppercase text-[10px] tracking-wide block">Renders with</span>
                          <span className="font-mono font-semibold text-foreground truncate block">{effectiveBundle.credential_type as string}</span>
                        </div>
                      )}
                    </div>
                    {/* Confirmation checkbox */}
                    <label className="flex items-start gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={publishConfirmed}
                        onChange={e => setPublishConfirmed(e.target.checked)}
                        className="mt-0.5 accent-amber-500"
                      />
                      <span className="text-xs text-muted-foreground">
                        I have reviewed the preview above, tested this schema in a dev environment, and confirm this is ready to publish.
                      </span>
                    </label>
                  </div>

                  <div className="flex items-center gap-3">
                    <Button
                      onClick={handlePublish}
                      disabled={publishMutation.isPending || !publishConfirmed}
                      size="sm"
                    >
                      {publishMutation.isPending ? 'Publishing…'
                        : publishable.length > 1 ? `Publish ${publishable.length} files`
                        : kindOf(effectiveBundle) === 'credential-schema' ? 'Publish credential schema'
                        : kindOf(effectiveBundle) === 'product' ? 'Publish product to Stripe'
                        : 'Publish'}
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      {!publishConfirmed ? 'Check the box above to enable publish' : 'Ready to publish'}
                    </p>
                  </div>
                </div>
              )}

            </CardContent>
          </Card>
        )}

        {/* Registry */}
        <Card>
          <CardHeader className="py-4">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Database size={14} />
              {isLoading
                ? 'Loading…'
                // Was counting credential types and calling them products, which
                // read as a product count and was wrong in both directions once a
                // schema could serve several.
                : [
                    `${visibleProducts.length} product${visibleProducts.length === 1 ? '' : 's'}`,
                    `${Object.keys(grouped).length} credential type${Object.keys(grouped).length === 1 ? '' : 's'}`,
                    `${visibleSchemas.length} schema version${visibleSchemas.length === 1 ? '' : 's'}`,
                    ...(orphanProducts.length > 0 ? [`${orphanProducts.length} without a schema`] : []),
                  ].join(' · ')}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading && <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>}
            {/* First run is when a vendor knows least, and it used to be the least
                guided moment on the site: one sentence naming what they did not
                have, and two unlabelled buttons in a far corner — one of which
                downloaded a template, the other of which opened the panel that
                would have explained it. */}
            {!isLoading && visibleSchemas.length === 0 && (
              <div className="px-6 py-10 max-w-2xl mx-auto space-y-5">
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Nothing published yet</h3>
                  <p className="text-sm text-muted-foreground">
                    A product takes two files, and they do different jobs.
                  </p>
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="rounded-lg border border-border p-3 space-y-1">
                    <p className="text-xs font-semibold">Credential schema</p>
                    <p className="text-xs text-muted-foreground">
                      What your verification returns. It decides how the credential
                      reads on the buyer's card and what they can share from it, which is
                      why we need it described rather than just delivered. Immutable once
                      published, so credentials already issued keep rendering.
                    </p>
                  </div>
                  <div className="rounded-lg border border-border p-3 space-y-1">
                    <p className="text-xs font-semibold">Product</p>
                    <p className="text-xs text-muted-foreground">
                      What a buyer is purchasing: the order form they fill in and the
                      price. Edited in place whenever you like.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Button size="sm" onClick={loadExamplePair}>
                    Load a working example
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Loads both files, already valid, so you can see them rendered and edit
                    from there.
                  </span>
                </div>
              </div>
            )}
            {(() => {
              const entries = Object.entries(grouped)
              const isPlatformKey = (key: string) =>
                (productsByType[key] ?? []).some(p => p.product_role === 'platform')
              const platformEntries = entries.filter(([key]) => isPlatformKey(key))
              const vendorEntries   = entries.filter(([key]) => !isPlatformKey(key))
              const renderGroup = ([key, versions]: [string, typeof schemas]) => {
                const [verifierId, credentialType] = key.split('/')
                return (
                  <SchemaGroup
                    key={key}
                    verifierId={verifierId}
                    credentialType={credentialType}
                    versions={[...versions].sort((a, b) => b.version.localeCompare(a.version))}
                    products={visibleProductsByType[key] ?? []}
                    drift={driftByVersion}
                    isPlatform={isPlatformKey(key)}
                    onArchive={(id) => {
                      productsApi.delete(id).then(() => {
                        queryClient.invalidateQueries({ queryKey: ['products'] })
                        toast.success('Product archived in Stripe')
                      }).catch(() => toast.error('Archive failed'))
                    }}
                    onDownload={downloadPublishedBundle}
                    onNewVersion={loadForNewVersion}
                  />
                )
              }
              return (
                <>
                  {platformEntries.length > 0 && (
                    <>
                      {!isPlatformMode && (
                        <div className="px-6 py-2 border-b border-border bg-amber-500/5 flex items-center gap-2">
                          <span className="text-xs font-semibold text-amber-600 uppercase tracking-wide">Platform Subscription</span>
                          <span className="text-xs text-muted-foreground">— gates vault + catalogue access for all professionals</span>
                        </div>
                      )}
                      {platformEntries.map(renderGroup)}
                    </>
                  )}
                  {vendorEntries.length > 0 && (
                    <>
                      {platformEntries.length > 0 && (
                        <div className="px-6 py-2 border-b border-border bg-muted/20 flex items-center gap-2">
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Vendor Products</span>
                          <span className="text-xs text-muted-foreground">— orderable from the professional catalogue</span>
                        </div>
                      )}
                      {vendorEntries.map(renderGroup)}
                    </>
                  )}

                  {/* Products naming a credential type with no published schema.
                      The list is grouped by schema, so these had no group to
                      appear under and were invisible — a product live in Stripe
                      and sellable, with nothing to render what it returns. */}
                  {orphanProducts.length > 0 && (
                    <>
                      <div className="px-6 py-2 border-y border-destructive/20 bg-destructive/5 flex items-center gap-2">
                        <AlertCircle size={12} className="text-destructive shrink-0" />
                        <span className="text-xs font-semibold text-destructive uppercase tracking-wide">No credential schema</span>
                        <span className="text-xs text-muted-foreground">
                          — live in Stripe, but nothing renders what they return
                        </span>
                      </div>
                      {orphanProducts.map(p => (
                        <div key={p.id ?? p.name} className="flex items-center justify-between gap-4 px-6 py-3 border-b border-border last:border-0">
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="font-mono text-sm font-medium shrink-0">{p.verifier_id}</span>
                            <Badge variant="outline" className="text-xs font-mono shrink-0 border-destructive/40 text-destructive">
                              {p.credential_type || 'no credential_type'}
                            </Badge>
                            <span className="text-sm truncate text-foreground/80">{p.name}</span>
                          </div>
                          <span className="text-xs text-muted-foreground shrink-0">
                            publish {p.verifier_id}/{p.credential_type} to fix
                          </span>
                        </div>
                      ))}
                    </>
                  )}
                </>
              )
            })()}
          </CardContent>
        </Card>
      </div>
    </>
  )
}

// ── Pricing mapper ────────────────────────────────────────────────────────────


