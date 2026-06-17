import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ChevronUp, ChevronDown, X, Plus, Code } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

export type OrderFieldType = 'text' | 'textarea' | 'enum' | 'boolean' | 'date' | 'array'

export interface OrderField {
  key: string
  title: string
  type: OrderFieldType
  required: boolean
  placeholder?: string
  help?: string
  enumOptions?: string[]   // type=enum: selectable options
  items?: OrderItemField[] // type=array: sub-fields per row
}

// Array sub-fields don't support nested arrays
export type OrderItemFieldType = 'text' | 'textarea' | 'enum' | 'boolean' | 'date'

export interface OrderItemField {
  key: string
  title: string
  type: OrderItemFieldType
  required: boolean
  placeholder?: string
  help?: string
  enumOptions?: string[]
}

const FIELD_TYPE_LABELS: Record<OrderFieldType, string> = {
  text: 'Text',
  textarea: 'Long text',
  enum: 'Dropdown',
  boolean: 'Checkbox',
  date: 'Date',
  array: 'Repeatable rows',
}

const ITEM_TYPE_LABELS: Record<OrderItemFieldType, string> = {
  text: 'Text',
  textarea: 'Long text',
  enum: 'Dropdown',
  boolean: 'Checkbox',
  date: 'Date',
}

// ── Order schema builder ──────────────────────────────────────────────────────

interface OrderSchemaBuilderProps {
  fields: OrderField[]
  onChange: (fields: OrderField[]) => void
}

export function OrderSchemaBuilder({ fields, onChange }: OrderSchemaBuilderProps) {
  const add = () => onChange([...fields, { key: '', title: '', type: 'text', required: false }])
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
    // Reset type-specific data when type changes
    if (patch.type && patch.type !== next[i].type) {
      next[i] = { ...next[i], enumOptions: undefined, items: undefined }
    }
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
        <div key={i} className="rounded-md bg-muted/30 border border-border overflow-hidden">
          {/* Field header row */}
          <div className="grid grid-cols-[1fr_1fr_auto_auto_auto] gap-2 items-start p-3">
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
              <label className="text-xs text-muted-foreground">Label</label>
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

            {/* Second row: type + placeholder + help */}
            {(f.key || f.title) && (
              <div className="col-span-5 grid grid-cols-3 gap-2 mt-1">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Field type</label>
                  <select
                    value={f.type}
                    onChange={e => update(i, { type: e.target.value as OrderFieldType })}
                    className="w-full h-7 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {(Object.keys(FIELD_TYPE_LABELS) as OrderFieldType[]).map(t => (
                      <option key={t} value={t}>{FIELD_TYPE_LABELS[t]}</option>
                    ))}
                  </select>
                </div>
                {f.type !== 'boolean' && f.type !== 'array' && f.type !== 'enum' && (
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Placeholder</label>
                    <Input
                      value={f.placeholder ?? ''}
                      onChange={e => update(i, { placeholder: e.target.value })}
                      placeholder="e.g. G12345"
                      className="text-xs h-7"
                    />
                  </div>
                )}
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Help text</label>
                  <Input
                    value={f.help ?? ''}
                    onChange={e => update(i, { help: e.target.value })}
                    placeholder="Shown below the field"
                    className="text-xs h-7"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Enum options editor */}
          {f.type === 'enum' && (
            <div className="px-3 pb-3 border-t border-border/50">
              <p className="text-xs text-muted-foreground mt-2 mb-1.5">Options</p>
              <EnumOptionsEditor
                options={f.enumOptions ?? []}
                onChange={opts => update(i, { enumOptions: opts })}
              />
            </div>
          )}

          {/* Array sub-field editor */}
          {f.type === 'array' && (
            <div className="px-3 pb-3 border-t border-border/50">
              <p className="text-xs text-muted-foreground mt-2 mb-1.5">Row fields</p>
              <ArrayItemFieldBuilder
                fields={f.items ?? []}
                onChange={items => update(i, { items })}
              />
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

// ── Enum options editor ───────────────────────────────────────────────────────

interface EnumOptionsEditorProps {
  options: string[]
  onChange: (options: string[]) => void
}

function EnumOptionsEditor({ options, onChange }: EnumOptionsEditorProps) {
  const [draft, setDraft] = useState('')

  const add = () => {
    const val = draft.trim()
    if (!val || options.includes(val)) return
    onChange([...options, val])
    setDraft('')
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1">
        {options.map((o, i) => (
          <span key={i} className="inline-flex items-center gap-1 text-xs bg-muted border border-border rounded px-2 py-0.5">
            {o}
            <button type="button" onClick={() => onChange(options.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive">
              <X size={10} />
            </button>
          </span>
        ))}
        {options.length === 0 && (
          <span className="text-xs text-muted-foreground italic">No options yet</span>
        )}
      </div>
      <div className="flex gap-1.5">
        <Input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder="Add option…"
          className="text-xs h-7 flex-1"
        />
        <Button type="button" variant="outline" size="sm" onClick={add} className="h-7 px-2">
          <Plus size={12} />
        </Button>
      </div>
    </div>
  )
}

// ── Array item field builder ──────────────────────────────────────────────────

interface ArrayItemFieldBuilderProps {
  fields: OrderItemField[]
  onChange: (fields: OrderItemField[]) => void
}

function ArrayItemFieldBuilder({ fields, onChange }: ArrayItemFieldBuilderProps) {
  const add = () => onChange([...fields, { key: '', title: '', type: 'text', required: false }])
  const remove = (i: number) => onChange(fields.filter((_, j) => j !== i))
  const move = (i: number, dir: -1 | 1) => {
    const next = [...fields]
    const j = i + dir
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  const update = (i: number, patch: Partial<OrderItemField>) => {
    const next = [...fields]
    next[i] = { ...next[i], ...patch }
    onChange(next)
  }

  return (
    <div className="space-y-1.5 pl-2 border-l-2 border-border">
      {fields.length === 0 && (
        <p className="text-xs text-muted-foreground italic">No row fields yet</p>
      )}
      {fields.map((f, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto_auto] gap-1.5 items-center p-2 rounded bg-background border border-border/60">
          <Input
            value={f.key}
            onChange={e => update(i, { key: e.target.value.replace(/\s/g, '_').toLowerCase() })}
            placeholder="field_key"
            className="font-mono text-xs h-7"
          />
          <Input
            value={f.title}
            onChange={e => update(i, { title: e.target.value })}
            placeholder="Field Label"
            className="text-xs h-7"
          />
          <select
            value={f.type}
            onChange={e => update(i, { type: e.target.value as OrderItemFieldType, enumOptions: undefined })}
            className="h-7 rounded-md border border-input bg-background px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {(Object.keys(ITEM_TYPE_LABELS) as OrderItemFieldType[]).map(t => (
              <option key={t} value={t}>{ITEM_TYPE_LABELS[t]}</option>
            ))}
          </select>
          <div className="flex gap-0.5">
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-30 p-0.5">
              <ChevronUp size={12} />
            </button>
            <button type="button" onClick={() => move(i, 1)} disabled={i === fields.length - 1} className="text-muted-foreground hover:text-foreground disabled:opacity-30 p-0.5">
              <ChevronDown size={12} />
            </button>
          </div>
          <button type="button" onClick={() => remove(i)} className="text-muted-foreground hover:text-destructive p-0.5">
            <X size={12} />
          </button>
          {/* Enum options for item fields */}
          {f.type === 'enum' && (
            <div className="col-span-5 mt-1">
              <EnumOptionsEditor
                options={f.enumOptions ?? []}
                onChange={opts => update(i, { enumOptions: opts })}
              />
            </div>
          )}
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add} className="w-full border-dashed h-7 text-xs">
        <Plus size={11} className="mr-1" /> Add row field
      </Button>
    </div>
  )
}

// ── Schema conversion: visual ↔ JSON Schema ───────────────────────────────────

export function orderFieldsToSchemas(fields: OrderField[]): {
  orderSchema: Record<string, unknown>
  orderUiSchema: Record<string, unknown>
} {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  const uiSchema: Record<string, unknown> = {}

  for (const f of fields) {
    if (!f.key) continue

    switch (f.type) {
      case 'text':
        properties[f.key] = { type: 'string', title: f.title || f.key }
        break
      case 'textarea':
        properties[f.key] = { type: 'string', title: f.title || f.key }
        uiSchema[f.key] = { ...(uiSchema[f.key] as object ?? {}), 'ui:widget': 'textarea' }
        break
      case 'enum':
        properties[f.key] = {
          type: 'string',
          title: f.title || f.key,
          enum: f.enumOptions ?? [],
        }
        break
      case 'boolean':
        properties[f.key] = { type: 'boolean', title: f.title || f.key }
        break
      case 'date':
        properties[f.key] = { type: 'string', title: f.title || f.key, format: 'date' }
        break
      case 'array': {
        const itemProperties: Record<string, unknown> = {}
        const itemRequired: string[] = []
        const itemUi: Record<string, unknown> = {}

        for (const sub of f.items ?? []) {
          if (!sub.key) continue
          switch (sub.type) {
            case 'text':
              itemProperties[sub.key] = { type: 'string', title: sub.title || sub.key }
              break
            case 'textarea':
              itemProperties[sub.key] = { type: 'string', title: sub.title || sub.key }
              itemUi[sub.key] = { 'ui:widget': 'textarea' }
              break
            case 'enum':
              itemProperties[sub.key] = {
                type: 'string',
                title: sub.title || sub.key,
                enum: sub.enumOptions ?? [],
              }
              break
            case 'boolean':
              itemProperties[sub.key] = { type: 'boolean', title: sub.title || sub.key }
              break
            case 'date':
              itemProperties[sub.key] = { type: 'string', title: sub.title || sub.key, format: 'date' }
              break
          }
          if (sub.placeholder) itemUi[sub.key] = { ...(itemUi[sub.key] as object ?? {}), 'ui:placeholder': sub.placeholder }
          if (sub.help) itemUi[sub.key] = { ...(itemUi[sub.key] as object ?? {}), 'ui:help': sub.help }
          if (sub.required) itemRequired.push(sub.key)
        }

        const itemOrder = (f.items ?? []).filter(s => s.key).map(s => s.key)
        if (itemOrder.length) itemUi['ui:order'] = itemOrder

        properties[f.key] = {
          type: 'array',
          title: f.title || f.key,
          items: {
            type: 'object',
            ...(itemRequired.length ? { required: itemRequired } : {}),
            properties: itemProperties,
          },
        }
        if (Object.keys(itemUi).length) {
          uiSchema[f.key] = { ...(uiSchema[f.key] as object ?? {}), items: itemUi }
        }
        break
      }
    }

    if (f.required) required.push(f.key)
    if (f.placeholder) uiSchema[f.key] = { ...(uiSchema[f.key] as object ?? {}), 'ui:placeholder': f.placeholder }
    if (f.help) uiSchema[f.key] = { ...(uiSchema[f.key] as object ?? {}), 'ui:help': f.help }
  }

  uiSchema['ui:order'] = fields.filter(f => f.key).map(f => f.key)

  return {
    orderSchema: {
      type: 'object',
      ...(required.length ? { required } : {}),
      properties,
    },
    orderUiSchema: uiSchema,
  }
}

export function schemasToOrderFields(
  orderSchema: Record<string, unknown>,
  orderUiSchema: Record<string, unknown>
): OrderField[] {
  const props = (orderSchema?.properties as Record<string, Record<string, unknown>>) ?? {}
  const req = (orderSchema?.required as string[]) ?? []
  const order = (orderUiSchema?.['ui:order'] as string[]) ?? Object.keys(props)

  return order.filter(k => k in props).map(k => {
    const prop = props[k]
    const hints = (orderUiSchema?.[k] as Record<string, unknown>) ?? {}
    const type = prop.type as string
    const format = prop.format as string | undefined
    const widget = hints['ui:widget'] as string | undefined
    const enumVals = prop.enum as string[] | undefined

    let fieldType: OrderFieldType = 'text'
    if (type === 'boolean') fieldType = 'boolean'
    else if (type === 'array') fieldType = 'array'
    else if (enumVals) fieldType = 'enum'
    else if (format === 'date') fieldType = 'date'
    else if (widget === 'textarea') fieldType = 'textarea'

    const base: OrderField = {
      key: k,
      title: (prop.title as string) ?? k,
      type: fieldType,
      required: req.includes(k),
      placeholder: hints['ui:placeholder'] as string | undefined,
      help: hints['ui:help'] as string | undefined,
    }

    if (fieldType === 'enum') base.enumOptions = enumVals ?? []

    if (fieldType === 'array') {
      const items = prop.items as Record<string, unknown> | undefined
      const itemProps = (items?.properties as Record<string, Record<string, unknown>>) ?? {}
      const itemReq = (items?.required as string[]) ?? []
      const itemUi = (hints?.items as Record<string, unknown>) ?? {}
      const itemOrder = (itemUi['ui:order'] as string[]) ?? Object.keys(itemProps)

      base.items = itemOrder.filter(ik => ik in itemProps).map(ik => {
        const ip = itemProps[ik]
        const iHints = (itemUi[ik] as Record<string, unknown>) ?? {}
        const iType = ip.type as string
        const iFormat = ip.format as string | undefined
        const iWidget = iHints['ui:widget'] as string | undefined
        const iEnum = ip.enum as string[] | undefined

        let iFieldType: OrderItemFieldType = 'text'
        if (iType === 'boolean') iFieldType = 'boolean'
        else if (iEnum) iFieldType = 'enum'
        else if (iFormat === 'date') iFieldType = 'date'
        else if (iWidget === 'textarea') iFieldType = 'textarea'

        return {
          key: ik,
          title: (ip.title as string) ?? ik,
          type: iFieldType,
          required: itemReq.includes(ik),
          placeholder: iHints['ui:placeholder'] as string | undefined,
          help: iHints['ui:help'] as string | undefined,
          enumOptions: iEnum,
        }
      })
    }

    return base
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
          <p className="text-xs font-medium text-muted-foreground">
            Groups <span className="font-normal">(optional — groups fields into labeled sections)</span>
          </p>
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

export function displayFieldsToSchemas(
  fields: DisplayField[],
  groups: DisplayGroup[]
): { dataSchema: Record<string, unknown>; uiSchema: Record<string, unknown> } {
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

export function schemasToDisplayFields(
  dataSchema: Record<string, unknown>,
  uiSchema: Record<string, unknown>
): { fields: DisplayField[]; groups: DisplayGroup[] } {
  const props =
    (dataSchema?.properties as Record<string, { title?: string; format?: string }>) ?? {}
  const order = (uiSchema?.['ui:order'] as string[]) ?? Object.keys(props)
  const rawGroups =
    (uiSchema?.['ui:groups'] as { title: string; fields: string[] }[]) ?? []

  const fields: DisplayField[] = order.filter(k => k in props).map(k => ({
    key: k,
    title: props[k]?.title ?? k,
    format: (props[k]?.format as DisplayFieldFormat) ?? 'text',
  }))

  return { fields, groups: rawGroups }
}

// ── Raw JSON toggle wrapper ───────────────────────────────────────────────────

export interface RawToggleRef {
  getRawText: () => string | null
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
    { key: 'first_name', title: 'First Name', type: 'text', required: false, placeholder: 'e.g. Jane' },
    { key: 'last_name', title: 'Last Name', type: 'text', required: false, placeholder: 'e.g. Smith' },
    { key: 'state', title: 'Issuing State', type: 'text', required: true, placeholder: 'e.g. CA', help: 'Two-letter state abbreviation' },
    { key: 'license_number', title: 'License Number', type: 'text', required: true, placeholder: 'e.g. G12345', help: 'Found on the front of your license card' },
    { key: 'license_type', title: 'License Type', type: 'text', required: false, placeholder: 'e.g. MD' },
  ],
  'CPR Certification': [
    { key: 'first_name', title: 'First Name', type: 'text', required: true, placeholder: 'e.g. Jane' },
    { key: 'last_name', title: 'Last Name', type: 'text', required: true, placeholder: 'e.g. Smith' },
    { key: 'certification_number', title: 'Certification Number', type: 'text', required: true, placeholder: 'e.g. AHA-123456' },
    { key: 'issuing_organization', title: 'Issuing Organization', type: 'text', required: false, placeholder: 'e.g. American Heart Association' },
  ],
  'Board Certification': [
    { key: 'first_name', title: 'First Name', type: 'text', required: true },
    { key: 'last_name', title: 'Last Name', type: 'text', required: true },
    { key: 'specialty', title: 'Specialty', type: 'text', required: true, placeholder: 'e.g. Internal Medicine' },
    { key: 'npi_number', title: 'NPI Number', type: 'text', required: false, placeholder: 'e.g. 1234567890', help: '10-digit National Provider Identifier' },
  ],
  'Provider Enrollment': [
    { key: 'provider_name', title: 'Provider Full Name', type: 'text', required: true },
    { key: 'npi_number', title: 'NPI Number', type: 'text', required: true, placeholder: 'e.g. 1234567890', help: '10-digit National Provider Identifier' },
    { key: 'specialty', title: 'Provider Type / Specialty', type: 'text', required: false },
    { key: 'organization', title: 'Organization / Practice Name', type: 'text', required: false },
    { key: 'email', title: 'Email Address', type: 'text', required: true },
    { key: 'phone', title: 'Mobile Phone Number', type: 'text', required: false },
    { key: 'contact_method', title: 'Preferred Contact Method', type: 'enum', required: false, enumOptions: ['Email', 'SMS', 'Phone'] },
    { key: 'primary_state', title: 'Primary State / Jurisdiction', type: 'text', required: true },
    { key: 'subscription_tier', title: 'Subscription Tier', type: 'enum', required: true, enumOptions: ['Essential Portable Verification', 'Advanced Portable Verification', 'Enterprise Portable Verification'] },
    {
      key: 'licenses',
      title: 'License / Jurisdiction',
      type: 'array',
      required: false,
      help: 'Add each license to be monitored',
      items: [
        { key: 'license_type', title: 'License Type', type: 'text', required: false },
        { key: 'state', title: 'State / Jurisdiction', type: 'text', required: true },
        { key: 'license_number', title: 'License Number', type: 'text', required: true },
        { key: 'expiration_date', title: 'Expiration Date', type: 'date', required: false },
        { key: 'include_monitoring', title: 'Include Monitoring', type: 'boolean', required: false },
      ],
    },
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
