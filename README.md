# ardis-admin-pwa

Operator and vendor portal for the CredPass platform. Two audiences, one app:

- **Instruxi operators** (tenant admin) — onboard verifiers, manage users, groups,
  terms and sessions, publish the platform subscription.
- **Vendors** (developer role) — publish their own credential schemas and
  products, and see them rendered exactly as a professional will.

- **Repo:** `instruxi-io/ardis-admin-pwa` (branch `master`)
- **Stack:** React 19, TypeScript, Vite 8, Tailwind 3, Radix UI, TanStack
  Query/Table, RJSF v6, react-hook-form + zod
- **Deployed:** Cloudflare Pages — `master.credpass-admin-portal-dev.pages.dev`

It talks to **two** backends: Enforcer directly for identity and administration,
and ardis-ms for schemas and products.

---

## Quickstart

```bash
npm install
cp .env.example .env.local
npm run dev            # http://localhost:3001
```

```bash
npm test               # vitest — 104 tests
npm run build          # tsc -b && vite build
npm run lint
npm run preview
```

### Environment

`src/config/env.ts` **throws at startup** if a required variable is missing,
rather than letting the app boot and fail later with a confusing 404.

| Variable | Required | Notes |
|---|---|---|
| `VITE_ENFORCER_BASE_URL` | **yes** | Gateway **including** `/api/v1/enforcer`, no trailing slash |
| `VITE_ARDIS_MS_URL` | **yes** | ardis-ms **including** `/api/v1/ardis`, no trailing slash |
| `VITE_APP_ENV` | no | Label in the header. Defaults to `production` |

Staging values are in `.env.example`. Vite bakes `VITE_*` in at **build** time, so
changing a deployed value needs a rebuild, not an env edit.

Full cross-repo reference:
[ardis-ms `docs/platform/ENVIRONMENT.md`](https://github.com/instruxi-io/ardis-ms-dev/blob/main/docs/platform/ENVIRONMENT.md).

---

## Deploying

**Manual wrangler — there is no deploy workflow in this repo.** The other three
repos deploy from CI; this one does not.

```bash
npm run build
npx wrangler pages deploy dist --project-name=credpass-admin-portal-dev
```

You need `wrangler login` (or `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`) and
Pages access on the Instruxi Cloudflare account.

### The service worker is deliberately self-destructing

`vite.config.ts` sets `VitePWA({ selfDestroying: true })`. Read the comment there
before changing it.

The PWA **manifest** is kept — installability is real value for a vendor and
carries no risk. The **service worker** is not: it precached `index.html` and bound
every navigation to that cached copy, so a deploy stayed invisible until the worker
updated on a later visit. Three deploys in one day appeared to serve the previous
build. An admin tool has to reflect a publish immediately, and nobody edits a
credential schema offline, so the caching bought nothing and cost trust in what was
on screen.

`selfDestroying` ships a worker that unregisters itself and clears old caches —
the only way to undo workers already registered in browsers that visited the site.
**Do not re-enable normal PWA caching here.**

---

## Routes

`src/App.tsx`. Everything except `/login` is behind `ProtectedRoute`, and the
index redirects to `/schemas` — schema publishing is the main job.

| Route | Page | Purpose |
|---|---|---|
| `/login` | `LoginPage` | Enforcer auth |
| `/tenants` | `TenantPickerPage` | Pick the active tenant (outside the shell) |
| `/schemas` | `SchemasPage mode="vendor"` | Publish and review vendor credential schemas + products |
| `/platform` | `SchemasPage mode="platform"` | The platform subscription that gates vault access. Tenant admin only |
| `/verifiers` | `VerifiersPage` | Onboard a vendor: user + group + `verifier_id` |
| `/users`, `/users/:id` | `UsersPage`, `UserDetailPage` | Enforcer user administration |
| `/groups`, `/groups/:id` | `GroupsPage`, `GroupDetailPage` | Groups and their metadata — where vendor identity lives |
| `/sessions` | `SessionsPage` | Active sessions |
| `/terms` | `TermsPage` | Terms of service versions |
| `/dashboard` | `DashboardPage` | Overview |

`SchemasPage` is one component in two modes. A schema is platform-scoped when any
product on it has `x-product-role: "platform"`, and the two lists are filtered
apart so a vendor's product never shows up as an orphan on the platform page and
vice versa.

---

## Layout

```
src/
  config/env.ts                 required-or-throw env access
  context/AuthContext.tsx       login state, active tenant, role
  lib/
    enforcerApiClient.ts        Enforcer gateway client
    ardisMsClient.ts            ardis-ms client
    jwt.ts                      token decode
    suggestGroups.ts            proposes ui:groups for an order form
    catalogue/
      bundleFormat.ts           parse/emit the triple-JSON bundle
      bundleValidation.ts       the pre-publish checks
      schemaChecks.ts           schema-level rules
      pricing.ts                Stripe price mapping
      publishPlan.ts            what publishing will actually do
      exampleFiles.ts           starter bundles for a first run
  components/
    catalogue/                  DropZone, PricingMapper, SchemaGroup, ValidationPanel
    ui/                         Radix-based primitives, RJSF theme,
                                schema-preview (credential) + schema-preview-order,
                                phone-frame, publish-confirm-modal
    layout/                     AppShell, Sidebar
    auth/ProtectedRoute.tsx
  pages/                        one per route above
  types/enforcer/               admin, auth, common API types
```

Everything under `src/lib/catalogue/` has a colocated `*.test.ts`, and those tests
are the bulk of the 104. If you change bundle parsing, validation or pricing, the
tests are the spec.

---

## The bundle format

A vendor uploads a single file containing **three JSON objects**:

| Object | Is |
|---|---|
| 1 | JSON Schema for the order form, plus `x-` metadata |
| 2 | UI Schema — order form layout |
| 3 | Sample data — drives the credential preview, stored as `sample_data` |

Object 1's `x-` metadata carries the identity and commercial terms:

```
x-verifier-id      who issues it — must match a verifier_id the caller may act for
x-credential-type  selects the display schema
x-order-type
x-version
x-pricing | x-price-one-time
x-data-schema      shape of the issued credential
x-data-ui-schema   how the credential renders
x-product-role     "platform" marks the subscription gate — tenant admin only
```

### Publish flow

```
1. Drop the file          → editable raw JSON textarea
2. Preview                → always visible: RJSF order form + credential card,
                            inside a phone frame
3. Validate               → ValidationPanel; blocking vs advisory
4. Stripe pricing         → PricingMapper
5. Publish gate           → confirm verifier_id / schema / version, plus a checkbox
```

Two guards worth knowing:

- **Developers may never publish a `platform`-role product.** Checked across the
  whole batch, not per file, so it can't be smuggled in alongside a normal one
  (`SchemasPage.tsx:415-421`).
- **`verifier_id` scoping is enforced server-side too.** The portal filters to your
  vendors, and ardis-ms independently re-checks group membership. See
  [ENFORCER_GROUPS.md](https://github.com/instruxi-io/ardis-ms-dev/blob/main/docs/platform/ENFORCER_GROUPS.md).

Published schemas are **versioned and immutable**. `latest` moves; a pinned version
never changes, so an audit can replay exactly what a credential was rendered
against.

### `ui:groups`

`ui:groups` turns a long order form into a multi-step wizard. It is **our
extension**, so the RJSF playground neither renders it nor offers a way to author
it — documenting the syntax would put the work on the vendor and give them nothing
to look at while they got it wrong.

`suggestGroups.ts` derives a starting point from the vendor's own schema instead:
required scalars first, each array its own step, enums and booleans grouped, terms
last. It is a heuristic meant to be edited, and it stays quiet for short forms
(fewer than 8 fields and no arrays) because paging through four fields adds taps
without reducing what's on screen.

### Rendering parity

The portal previews with **RJSF v6**; the mobile app renders with a bundled **RJSF
v5** (`assets/html/rjsf.bundle.js`), and the viewer portal has its own renderer.
The intent is that all three agree — the preview exists so a vendor sees what a
professional will see. **The RJSF major versions differ**, so treat the preview as
very close rather than byte-identical, and check anything layout-critical on a real
device.

---

## Onboarding a verifier

`/verifiers` runs an ordered, fail-loud sequence. It is **not transactional** — on
failure it tells you what was already created so you can finish or remove it.

```
0. refuse a verifier_id that is already claimed  (also refuses if the group
                                                  list is unreadable — a duplicate
                                                  is worse than not onboarding)
1. POST admin/users          developer role
2. POST admin/groups         named for the company
3. PATCH .../metadata        add verifier_id, status, display_name
4. POST .../users            add the developer to the group
```

Then, outside the portal: set `VENDOR_API_KEY_{VERIFIER_ID}` as a Fly secret on
ardis-ms, add `order_url` to the group metadata, register the vendor's signing key
via `PUT /verifier-keys`, and complete Stripe Connect for `stripe_account_id`.

Two traps: `username` is **not** `verifier_id` (the account `ardis-vp` holds
`verifier_id` `ardis`), and **until step 3 lands the group is inert** — it is
invisible to `FindVendorGroup` and therefore to everything downstream, with no
error. Details:
[ENFORCER_GROUPS.md](https://github.com/instruxi-io/ardis-ms-dev/blob/main/docs/platform/ENFORCER_GROUPS.md).

---

## Known issues

- **Branding is inconsistent:** the PWA manifest says "Ardis Admin Portal" while
  the sidebar says "CredPass Admin". Pick one.
- **The main bundle is ~1.07 MB** (327 kB gzipped) and the build warns about it. No
  code splitting is configured.
- **RJSF major-version skew** between this portal (v6) and the app (v5) — see
  Rendering parity.
- **Deploys are manual.** Easy to forget, and there is no CI check that the
  deployed build matches `master`.
- `ProductsPage.tsx` was removed during cleanup: it was never routed and had become
  a read-only Stripe viewer. Products are managed in Stripe (the source of truth)
  and published through `/schemas`.

---

## Related

| Doc | Covers |
|---|---|
| [ENVIRONMENT.md](https://github.com/instruxi-io/ardis-ms-dev/blob/main/docs/platform/ENVIRONMENT.md) | Every env var, all four repos |
| [ENFORCER_GROUPS.md](https://github.com/instruxi-io/ardis-ms-dev/blob/main/docs/platform/ENFORCER_GROUPS.md) | Tenants, roles, groups, vendor identity |
| [SHARING.md](https://github.com/instruxi-io/ardis-ms-dev/blob/main/docs/platform/SHARING.md) | Fulfillment and sharing flows, including schemas |
| [ardis-ms README](https://github.com/instruxi-io/ardis-ms-dev) | The API this portal writes to |
| [ubuild-ardis README](https://github.com/instruxi-io/ubuild-ardis) | The mobile app that consumes what you publish |
