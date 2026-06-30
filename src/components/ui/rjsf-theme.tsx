/**
 * Custom RJSF templates and widgets styled with Tailwind to match the
 * admin portal / app aesthetic. Used for view model preview in SchemasPage.
 *
 * Templates:   FieldTemplate, ObjectFieldTemplate, ArrayFieldTemplate
 * Widgets:     TextWidget, SelectWidget, CheckboxWidget, DateWidget
 *
 * ui:groups support is implemented in ObjectFieldTemplate — fields are
 * grouped into named sections matching the Flutter JsonSchemaForm renderer.
 */

import type {
  FieldTemplateProps,
  ObjectFieldTemplateProps,
  ArrayFieldTemplateProps,
  WidgetProps,
  RegistryWidgetsType,
  TemplatesType,
} from '@rjsf/utils'

// ── Field template — wraps label + input + error ──────────────────────────────

export function FieldTemplate({
  id,
  label,
  required,
  errors,
  children,
  hidden,
  displayLabel,
}: FieldTemplateProps) {
  if (hidden) return <>{children}</>
  return (
    <div className="space-y-1.5">
      {displayLabel && label && (
        <label htmlFor={id} className="block text-xs font-medium text-muted-foreground">
          {label}
          {required && <span className="text-destructive ml-0.5">*</span>}
        </label>
      )}
      {children}
      {errors && (
        <div className="text-xs text-destructive space-y-0.5">
          {errors}
        </div>
      )}
    </div>
  )
}

// ── Object field template — handles ui:groups grouping ────────────────────────

export function ObjectFieldTemplate({
  properties,
  uiSchema,
  title,
  readonly,
}: ObjectFieldTemplateProps) {
  const groups = uiSchema?.['ui:groups'] as { title: string; fields: string[] }[] | undefined

  // Build a map of field name → rendered property element
  const propMap = Object.fromEntries(
    properties.map(p => [p.name, p.content])
  )

  if (groups && groups.length > 0) {
    // Render grouped sections — matches Flutter JsonSchemaForm ui:groups
    const seen = new Set<string>()
    const sections = groups.map(g => {
      const fields = g.fields.filter(f => propMap[f])
      fields.forEach(f => seen.add(f))
      return { title: g.title, fields }
    })

    // Ungrouped remainder
    const remainder = properties.filter(p => !seen.has(p.name))

    return (
      <div className="space-y-4">
        {title && (
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {title}
          </p>
        )}
        {sections.map(section => (
          <div key={section.title} className="space-y-3">
            <div className="flex items-center gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-primary/70">
                {section.title}
              </p>
              <div className="flex-1 h-px bg-border" />
            </div>
            <div className={readonly ? 'space-y-1' : 'space-y-3'}>
              {section.fields.map(f => (
                <div key={f}>{propMap[f]}</div>
              ))}
            </div>
          </div>
        ))}
        {remainder.length > 0 && (
          <div className="space-y-3">
            {remainder.map(p => <div key={p.name}>{p.content}</div>)}
          </div>
        )}
      </div>
    )
  }

  // Flat list — respect ui:order if present
  const order = uiSchema?.['ui:order'] as string[] | undefined
  const ordered = order
    ? [
        ...order.filter(f => propMap[f]).map(f => ({ name: f, content: propMap[f] })),
        ...properties.filter(p => !order.includes(p.name)),
      ]
    : properties

  return (
    <div className="space-y-3">
      {title && (
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {title}
        </p>
      )}
      {ordered.map(p => (
        <div key={typeof p === 'object' && 'name' in p ? p.name : String(p)}>
          {typeof p === 'object' && 'content' in p ? p.content : null}
        </div>
      ))}
    </div>
  )
}

// ── Array field template ───────────────────────────────────────────────────────

export function ArrayFieldTemplate({ title, items }: ArrayFieldTemplateProps) {
  return (
    <div className="space-y-2">
      {title && (
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-primary/70">{title}</p>
          <div className="flex-1 h-px bg-border" />
        </div>
      )}
      {items.map((item, i) => (
        <div key={item.key} className={i > 0 ? 'pt-2 border-t border-border/40' : ''}>
          {(item as any).children}
        </div>
      ))}
    </div>
  )
}

// ── Readonly value display ────────────────────────────────────────────────────

function ReadonlyValue({ label, value }: { label?: string; value: string }) {
  return (
    <div className="flex items-start gap-2 py-1">
      {label && (
        <span className="text-xs text-muted-foreground w-36 shrink-0">{label}</span>
      )}
      <span className="text-sm font-medium text-foreground">{value || '—'}</span>
    </div>
  )
}

// ── Text widget ───────────────────────────────────────────────────────────────

export function TextWidget({ id, value, onChange, readonly, disabled, rawErrors, schema }: WidgetProps) {
  if (readonly || disabled) {
    let display = value ?? ''
    if (schema.format === 'date' && display) {
      const d = new Date(display)
      if (!isNaN(d.getTime())) {
        display = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      }
    }
    return <ReadonlyValue value={String(display)} />
  }
  return (
    <input
      id={id}
      type={schema.format === 'date' ? 'date' : 'text'}
      value={value ?? ''}
      onChange={e => onChange(e.target.value === '' ? undefined : e.target.value)}
      className={`w-full h-9 rounded-md border bg-background px-3 py-1 text-sm shadow-sm transition-colors
        focus:outline-none focus:ring-1 focus:ring-ring
        ${rawErrors?.length ? 'border-destructive' : 'border-input'}`}
    />
  )
}

// ── Select widget (enum fields) ───────────────────────────────────────────────

export function SelectWidget({ id, value, onChange, readonly, disabled, options, rawErrors }: WidgetProps) {
  const enumOptions = (options.enumOptions ?? []) as { value: string; label: string }[]

  if (readonly || disabled) {
    const found = enumOptions.find(o => o.value === value)
    return <ReadonlyValue value={found?.label ?? String(value ?? '—')} />
  }

  return (
    <select
      id={id}
      value={value ?? ''}
      onChange={e => onChange(e.target.value === '' ? undefined : e.target.value)}
      className={`w-full h-9 rounded-md border bg-background px-3 py-1 text-sm shadow-sm transition-colors
        focus:outline-none focus:ring-1 focus:ring-ring
        ${rawErrors?.length ? 'border-destructive' : 'border-input'}`}
    >
      <option value="">Select…</option>
      {enumOptions.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

// ── Checkbox widget (boolean fields) ─────────────────────────────────────────

export function CheckboxWidget({ id, value, label, onChange, readonly }: WidgetProps) {
  if (readonly) {
    return <ReadonlyValue value={value ? 'Yes' : 'No'} />
  }
  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        type="checkbox"
        checked={!!value}
        onChange={e => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-input"
      />
      <label htmlFor={id} className="text-sm">{label}</label>
    </div>
  )
}

// ── Textarea widget ───────────────────────────────────────────────────────────

export function TextareaWidget({ id, value, onChange, readonly, rawErrors }: WidgetProps) {
  if (readonly) return <ReadonlyValue value={String(value ?? '—')} />
  return (
    <textarea
      id={id}
      value={value ?? ''}
      onChange={e => onChange(e.target.value === '' ? undefined : e.target.value)}
      rows={3}
      className={`w-full rounded-md border bg-background px-3 py-2 text-sm shadow-sm transition-colors
        focus:outline-none focus:ring-1 focus:ring-ring resize-none
        ${rawErrors?.length ? 'border-destructive' : 'border-input'}`}
    />
  )
}

// ── Exported registry objects for use with <JsonForms> ────────────────────────

export const ardisWidgets: RegistryWidgetsType = {
  TextWidget,
  SelectWidget,
  CheckboxWidget,
  RadioWidget: SelectWidget,
  TextareaWidget,
  DateWidget: TextWidget,
  DateTimeWidget: TextWidget,
  PasswordWidget: TextWidget,
  UpDownWidget: TextWidget,
  RangeWidget: TextWidget,
  ColorWidget: TextWidget,
  FileWidget: () => <span className="text-xs text-muted-foreground italic">File attachment</span>,
}

export const ardisTemplates: Partial<TemplatesType> = {
  FieldTemplate,
  ObjectFieldTemplate,
  ArrayFieldTemplate,
}
