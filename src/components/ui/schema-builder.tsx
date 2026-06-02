import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ChevronUp, ChevronDown, X, Plus, Code } from 'lucide-react'

// ── Order schema builder ──────────────────────────────────────────────────────

export interface OrderField {
  key: string
  title: string
  required: boolean
  placeholder?: string
  help?: string
}

interface OrderSchemaBuilderProps {
  fields: OrderField[]
  onChange: (fields: OrderField[]) => void
}

export function OrderSchemaBuilder({ fields, onChange }: OrderSchemaBuilderProps) {
  const add = () => onChange([...fields, { key: '', title: '', required: false }])
  const remove = (i: number) => onChange(fields.filter((_, j) => j !== i))
  const move = (i: number, dir: -1 | 1) => {
    const next = [...fields]
    const j = i + dir
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  const update = (i: number, patch: Partial<OrderField>) => {
    const next = [...fields]
    next[i] = { ...next[i], ...patch }
    onChange(next)
  }

  return (
    <div className="space-y-2">
      {fields.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-3 border border-dashed border-border rounded-md">
          No fields yet — click "Add Field"
        </p>
      )}
      {fields.map((f, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto_auto] gap-2 items-start p-3 rounded-md bg-muted/30 border border-border">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Field key</label>
            <Input
              value={f.key}
              onChange={e => update(i, { key: e.target.value.replace(/\s/g, '_').toLowerCase() })}
              placeholder="license_number"
              className="font-mono text-xs h-8"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Label shown to user</label>
            <Input
              value={f.title}
              onChange={e => update(i, { title: e.target.value })}
              placeholder="License Number"
              className="text-xs h-8"
            />
          </div>
          <div className="flex flex-col items-center gap-1 pt-4">
            <button
              type="button"
              onClick={() => update(i, { required: !f.required })}
              className={`text-xs px-1.5 py-0.5 rounded border transition-colors ${f.required ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground border-border hover:border-primary/50'}`}
            >
              req
            </button>
          </div>
          <div className="flex flex-col gap-1 pt-4">
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-30">
              <ChevronUp size={14} />
            </button>
            <button type="button" onClick={() => move(i, 1)} disabled={i === fields.length - 1} className="text-muted-foreground hover:text-foreground disabled:opacity-30">
              <ChevronDown size={14} />
            </button>
          </div>
          <button type="button" onClick={() => remove(i)} className="mt-4 text-muted-foreground hover:text-destructive">
            <X size={14} />
          </button>
          {(f.key || f.title) && (
            <div className="col-span-5 grid grid-cols-2 gap-2 mt-1">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Placeholder</label>
                <Input
                  value={f.placeholder ?? ''}
                  onChange={e => update(i, { placeholder: e.target.value })}
                  placeholder="e.g. G12345"
                  className="text-xs h-7"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Help text</label>
                <Input
                  value={f.help ?? ''}
                  onChange={e => update(i, { help: e.target.value })}
                  placeholder="Found on the front of your license card"
                  className="text-xs h-7"
                />
              </div>
            </div>
          )}
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add} className="w-full border-dashed">
        <Plus size={13} className="mr-1.5" /> Add Field
      </Button>
    </div>
  )
}

export function orderFieldsToSchemas(fields: OrderField[]): { orderSchema: Record<string, unknown>; orderUiSchema: Record<string, unknown> } {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  const uiSchema: Record<string, unknown> = {}

  for (const f of fields) {
    if (!f.key) continue
    properties[f.key] = { type: 'string', title: f.title || f.key }
    if (f.required) required.push(f.key)
    const hints: Record<string, string> = {}
    if (f.placeholder) hints['ui:placeholder'] = f.placeholder
    if (f.help) hints['ui:help'] = f.help
    if (Object.keys(hints).length) uiSchema[f.key] = hints
  }

  uiSchema['ui:order'] = fields.filter(f => f.key).map(f => f.key)

  return {
    orderSchema: { type: 'object', ...(required.length ? { required } : {}), properties },
    orderUiSchema: uiSchema,
  }
}

export function schemasToOrderFields(orderSchema: Record<string, unknown>, orderUiSchema: Record<string, unknown>): OrderField[] {
  const props = (orderSchema?.properties as Record<string, { title?: string }>) ?? {}
  const req = (orderSchema?.required as string[]) ?? []
  const order = (orderUiSchema?.['ui:order'] as string[]) ?? Object.keys(props)
  return order
    .filter(k => k in props)
    .map(k => {
      const hints = (orderUiSchema?.[k] as Record<string, string>) ?? {}
      return {
        key: k,
        title: props[k]?.title ?? k,
        required: req.includes(k),
        placeholder: hints['ui:placeholder'],
        help: hints['ui:help'],
      }
    })
}

// ── Display schema builder ────────────────────────────────────────────────────

export type DisplayFieldFormat = 'text' | 'date' | 'date-time'

export interface DisplayField {
  key: string
  title: string
  format: DisplayFieldFormat
}

export interface DisplayGroup {
  title: string
  fields: string[]
}

interface DisplaySchemaBuilderProps {
  fields: DisplayField[]
  groups: DisplayGroup[]
  onFieldsChange: (fields: DisplayField[]) => void
  onGroupsChange: (groups: DisplayGroup[]) => void
}

export function DisplaySchemaBuilder({ fields, groups, onFieldsChange, onGroupsChange }: DisplaySchemaBuilderProps) {
  const addField = () => onFieldsChange([...fields, { key: '', title: '', format: 'text' }])
  const removeField = (i: number) => onFieldsChange(fields.filter((_, j) => j !== i))
  const moveField = (i: number, dir: -1 | 1) => {
    const next = [...fields]
    const j = i + dir
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    onFieldsChange(next)
  }
  const updateField = (i: number, patch: Partial<DisplayField>) => {
    const next = [...fields]
    next[i] = { ...next[i], ...patch }
    onFieldsChange(next)
  }

  const addGroup = () => onGroupsChange([...groups, { title: '', fields: [] }])
  const removeGroup = (i: number) => onGroupsChange(groups.filter((_, j) => j !== i))
  const updateGroup = (i: number, patch: Partial<DisplayGroup>) => {
    const next = [...groups]
    next[i] = { ...next[i], ...patch }
    onGroupsChange(next)
  }
  const toggleGroupField = (groupIdx: number, key: string) => {
    const g = groups[groupIdx]
    const next = g.fields.includes(key) ? g.fields.filter(f => f !== key) : [...g.fields, key]
    updateGroup(groupIdx, { fields: next })
  }

  const validFields = fields.filter(f => f.key)

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Fields</p>
        {fields.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-3 border border-dashed border-border rounded-md">
            No fields yet
          </p>
        )}
        {fields.map((f, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto_auto] gap-2 items-center p-2 rounded-md bg-muted/30 border border-border">
            <Input
              value={f.key}
              onChange={e => updateField(i, { key: e.target.value.replace(/\s/g, '_').toLowerCase() })}
              placeholder="license_number"
              className="font-mono text-xs h-8"
            />
            <Input
              value={f.title}
              onChange={e => updateField(i, { title: e.target.value })}
              placeholder="License Number"
              className="text-xs h-8"
            />
            <select
              value={f.format}
              onChange={e => updateField(i, { format: e.target.value as DisplayFieldFormat })}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="text">Text</option>
              <option value="date">Date</option>
              <option value="date-time">Date+Time</option>
            </select>
            <div className="flex gap-0.5">
              <button type="button" onClick={() => moveField(i, -1)} disabled={i === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-30 p-0.5">
                <ChevronUp size={13} />
              </button>
              <button type="button" onClick={() => moveField(i, 1)} disabled={i === fields.length - 1} className="text-muted-foreground hover:text-foreground disabled:opacity-30 p-0.5">
                <ChevronDown size={13} />
              </button>
            </div>
            <button type="button" onClick={() => removeField(i)} className="text-muted-foreground hover:text-destructive p-0.5">
              <X size={13} />
            </button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={addField} className="w-full border-dashed">
          <Plus size={13} className="mr-1.5" /> Add Field
        </Button>
      </div>

      {validFields.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Groups <span className="font-normal">(optional — groups fields into labeled sections)</span></p>
          {groups.map((g, i) => (
            <div key={i} className="p-3 rounded-md border border-border space-y-2">
              <div className="flex items-center gap-2">
                <Input
                  value={g.title}
                  onChange={e => updateGroup(i, { title: e.target.value })}
                  placeholder="Section title (e.g. Practitioner)"
                  className="text-xs h-8 flex-1"
                />
                <button type="button" onClick={() => removeGroup(i)} className="text-muted-foreground hover:text-destructive shrink-0">
                  <X size={13} />
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {validFields.map(f => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => toggleGroupField(i, f.key)}
                    className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${g.fields.includes(f.key) ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground border-border hover:border-primary/50'}`}
                  >
                    {f.title || f.key}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addGroup} className="w-full border-dashed">
            <Plus size={13} className="mr-1.5" /> Add Group
          </Button>
        </div>
      )}
    </div>
  )
}

export function displayFieldsToSchemas(fields: DisplayField[], groups: DisplayGroup[]): { dataSchema: Record<string, unknown>; uiSchema: Record<string, unknown> } {
  const properties: Record<string, unknown> = {}
  for (const f of fields) {
    if (!f.key) continue
    properties[f.key] = {
      type: 'string',
      title: f.title || f.key,
      ...(f.format !== 'text' ? { format: f.format } : {}),
    }
  }

  const validOrder = fields.filter(f => f.key).map(f => f.key)
  const uiSchema: Record<string, unknown> = { 'ui:order': validOrder }
  if (groups.filter(g => g.title && g.fields.length).length > 0) {
    uiSchema['ui:groups'] = groups
      .filter(g => g.title && g.fields.length)
      .map(g => ({ title: g.title, fields: g.fields }))
  }

  return { dataSchema: { type: 'object', properties }, uiSchema }
}

export function schemasToDisplayFields(dataSchema: Record<string, unknown>, uiSchema: Record<string, unknown>): { fields: DisplayField[]; groups: DisplayGroup[] } {
  const props = (dataSchema?.properties as Record<string, { title?: string; format?: string }>) ?? {}
  const order = (uiSchema?.['ui:order'] as string[]) ?? Object.keys(props)
  const rawGroups = (uiSchema?.['ui:groups'] as { title: string; fields: string[] }[]) ?? []

  const fields: DisplayField[] = order.filter(k => k in props).map(k => ({
    key: k,
    title: props[k]?.title ?? k,
    format: (props[k]?.format as DisplayFieldFormat) ?? 'text',
  }))

  return { fields, groups: rawGroups }
}

// ── Raw JSON toggle wrapper ───────────────────────────────────────────────────
// Syncs visual ↔ raw at toggle time. onSerialize: serialize visual state to JSON string.
// onDeserialize: parse raw JSON string and update visual state. Returns false if invalid.

export interface RawToggleRef {
  getRawText: () => string | null  // null = not in raw mode
}

interface RawToggleProps {
  children: React.ReactNode
  label?: string
  onSerialize: () => string
  onDeserialize: (raw: string) => boolean
  toggleRef?: React.MutableRefObject<RawToggleRef | null>
}

export function RawToggle({ children, label, onSerialize, onDeserialize, toggleRef }: RawToggleProps) {
  const [showRaw, setShowRaw] = useState(false)
  const [rawText, setRawText] = useState('')
  const [parseError, setParseError] = useState('')

  // Expose current raw text to parent for submit-time access
  if (toggleRef) {
    toggleRef.current = { getRawText: () => showRaw ? rawText : null }
  }

  const switchToRaw = () => {
    setRawText(onSerialize())
    setParseError('')
    setShowRaw(true)
  }

  const switchToVisual = () => {
    const ok = onDeserialize(rawText)
    if (!ok) {
      setParseError('Invalid JSON — fix before switching back')
      return
    }
    setParseError('')
    setShowRaw(false)
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        {label && <label className="text-xs font-medium text-muted-foreground">{label}</label>}
        <button
          type="button"
          onClick={showRaw ? switchToVisual : switchToRaw}
          className={`flex items-center gap-1 text-xs transition-colors ml-auto ${showRaw ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
        >
          <Code size={12} /> {showRaw ? 'Back to Visual' : 'Raw JSON'}
        </button>
      </div>
      {showRaw ? (
        <div className="space-y-1">
          <textarea
            value={rawText}
            onChange={e => { setRawText(e.target.value); setParseError('') }}
            rows={8}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {parseError && <p className="text-xs text-destructive">{parseError}</p>}
        </div>
      ) : (
        children
      )}
    </div>
  )
}

// ── Pre-built templates ───────────────────────────────────────────────────────

export const ORDER_TEMPLATES: Record<string, OrderField[]> = {
  'Medical License': [
    { key: 'first_name', title: 'First Name', required: false, placeholder: 'e.g. Jane' },
    { key: 'last_name', title: 'Last Name', required: false, placeholder: 'e.g. Smith' },
    { key: 'state', title: 'Issuing State', required: true, placeholder: 'e.g. CA', help: 'Two-letter state abbreviation' },
    { key: 'license_number', title: 'License Number', required: true, placeholder: 'e.g. G12345', help: 'Found on the front of your license card' },
    { key: 'license_type', title: 'License Type', required: false, placeholder: 'e.g. MD' },
  ],
  'CPR Certification': [
    { key: 'first_name', title: 'First Name', required: true, placeholder: 'e.g. Jane' },
    { key: 'last_name', title: 'Last Name', required: true, placeholder: 'e.g. Smith' },
    { key: 'certification_number', title: 'Certification Number', required: true, placeholder: 'e.g. AHA-123456' },
    { key: 'issuing_organization', title: 'Issuing Organization', required: false, placeholder: 'e.g. American Heart Association' },
  ],
  'Board Certification': [
    { key: 'first_name', title: 'First Name', required: true },
    { key: 'last_name', title: 'Last Name', required: true },
    { key: 'specialty', title: 'Specialty', required: true, placeholder: 'e.g. Internal Medicine' },
    { key: 'npi_number', title: 'NPI Number', required: false, placeholder: 'e.g. 1234567890', help: '10-digit National Provider Identifier' },
  ],
}

export const DISPLAY_TEMPLATES: Record<string, { fields: DisplayField[]; groups: DisplayGroup[] }> = {
  'Medical License': {
    fields: [
      { key: 'first_name', title: 'First Name', format: 'text' },
      { key: 'last_name', title: 'Last Name', format: 'text' },
      { key: 'license_number', title: 'License Number', format: 'text' },
      { key: 'license_type', title: 'License Type', format: 'text' },
      { key: 'state', title: 'State', format: 'text' },
      { key: 'expiration_date', title: 'Expiration Date', format: 'date' },
    ],
    groups: [
      { title: 'Practitioner', fields: ['first_name', 'last_name'] },
      { title: 'License', fields: ['license_number', 'license_type', 'state', 'expiration_date'] },
    ],
  },
  'CPR Certification': {
    fields: [
      { key: 'first_name', title: 'First Name', format: 'text' },
      { key: 'last_name', title: 'Last Name', format: 'text' },
      { key: 'certification_number', title: 'Certification Number', format: 'text' },
      { key: 'issued_date', title: 'Issued', format: 'date' },
      { key: 'expiration_date', title: 'Expires', format: 'date' },
    ],
    groups: [
      { title: 'Holder', fields: ['first_name', 'last_name'] },
      { title: 'Certification', fields: ['certification_number', 'issued_date', 'expiration_date'] },
    ],
  },
}
