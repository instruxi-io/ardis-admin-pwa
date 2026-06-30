/**
 * Schema preview components for the View Models import page.
 *
 * OrderFormPreview    — interactive RJSF form rendered in a phone frame.
 *                       Uses order_schema + order_ui_schema. Vendors fill in
 *                       fields and see live AJV validation.
 *
 * CredentialPreview   — read-only RJSF render of data_schema + ui_schema
 *                       with the sample `data` payload from the bundle.
 *                       Matches what the Flutter JsonSchemaForm renders.
 */

import { useState } from 'react'
import Form from '@rjsf/core'
import validator from '@rjsf/validator-ajv8'
import { ardisWidgets, ardisTemplates } from './rjsf-theme'
import { Layers, ShieldCheck } from 'lucide-react'

// ── Shared phone frame ────────────────────────────────────────────────────────

function PhoneFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title}</p>
      <div className="relative bg-[#0a0a0a] rounded-[2.5rem] border-4 border-[#2a2a2a] shadow-2xl"
        style={{ width: 320, minHeight: 580 }}>
        {/* Notch */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-6 bg-[#0a0a0a] rounded-b-2xl z-10" />
        {/* Screen */}
        <div className="rounded-[2rem] overflow-hidden bg-[#111111]" style={{ minHeight: 572 }}>
          {/* Status bar */}
          <div className="h-8 bg-[#0f0f0f] flex items-end justify-between px-6 pb-1">
            <span className="text-[10px] text-[#6b7280]">9:41</span>
            <span className="text-[10px] text-[#6b7280]">●●●</span>
          </div>
          {/* Content — force dark so CSS variables resolve to dark-mode values
              against the dark phone background */}
          <div className="dark px-4 py-3 overflow-y-auto" style={{ maxHeight: 524 }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Order form preview ────────────────────────────────────────────────────────

export function OrderFormPreview({
  schema,
  uiSchema,
}: {
  schema: Record<string, unknown>
  uiSchema: Record<string, unknown>
}) {
  const [formData, setFormData] = useState<Record<string, unknown>>({})
  const [hasErrors, setHasErrors] = useState(false)

  return (
    <PhoneFrame title="Order Form">
      <div className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-white">Place Order</h2>
          <p className="text-[11px] text-[#6b7280]">Fill in the required information below</p>
        </div>

        <Form
          schema={schema as any}
          uiSchema={uiSchema as any}
          formData={formData}
          validator={validator}
          widgets={ardisWidgets}
          templates={ardisTemplates}
          onChange={({ formData: d, errors }) => {
            setFormData(d ?? {})
            setHasErrors(errors.length > 0)
          }}
          onSubmit={() => {}}
          onError={() => setHasErrors(true)}
          // Remove default submit button — we render our own
          children={<span />}
        />

        {/* CTA button */}
        <button
          type="button"
          className={`w-full py-3 rounded-xl text-sm font-semibold transition-colors
            ${hasErrors
              ? 'bg-[#2a2a2a] text-[#6b7280] cursor-not-allowed'
              : 'bg-[#C9A84C] text-black hover:bg-[#b8973d]'}`}
        >
          Continue
        </button>
      </div>
    </PhoneFrame>
  )
}

// ── Credential display preview ────────────────────────────────────────────────

export function CredentialPreview({
  schema,
  uiSchema,
  data,
  verifierName,
  credentialType,
}: {
  schema: Record<string, unknown>
  uiSchema: Record<string, unknown>
  data: Record<string, unknown>
  verifierName?: string
  credentialType?: string
}) {
  return (
    <PhoneFrame title="Credential Card">
      <div className="space-y-4">
        {/* Credential header */}
        <div className="flex items-center gap-3 pb-3 border-b border-[#2a2a2a]">
          <div className="w-10 h-10 rounded-full bg-[#C9A84C]/15 flex items-center justify-center shrink-0">
            <Layers size={16} className="text-[#C9A84C]" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white truncate">
              {verifierName ?? 'Verified Credential'}
            </p>
            {credentialType && (
              <p className="text-[10px] text-[#6b7280] capitalize">{credentialType}</p>
            )}
          </div>
          <div className="ml-auto flex items-center gap-1">
            <ShieldCheck size={14} className="text-emerald-500" />
            <span className="text-[10px] text-emerald-500 font-medium">Active</span>
          </div>
        </div>

        {/* Rendered schema with sample data */}
        {Object.keys(data).length > 0 ? (
          <div className="[&_button]:hidden [&_.array-item-toolbox]:hidden [&_input]:pointer-events-none [&_select]:pointer-events-none [&_textarea]:pointer-events-none">
            <Form
              schema={schema as any}
              uiSchema={{ ...uiSchema as any, 'ui:readonly': true }}
              formData={data}
              validator={validator}
              widgets={ardisWidgets}
              templates={ardisTemplates}
              onChange={() => {}}
              onSubmit={() => {}}
            >
              <span />
            </Form>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[11px] text-[#4b5563] italic text-center py-4">
              Add a <span className="font-mono text-[#C9A84C]">data</span> field to your bundle JSON to see a live preview with sample values.
            </p>
            <div className="[&_button]:hidden [&_.array-item-toolbox]:hidden">
              <Form
                schema={schema as any}
                uiSchema={uiSchema as any}
                formData={{}}
                validator={validator}
                widgets={ardisWidgets}
                templates={ardisTemplates}
                onChange={() => {}}
                onSubmit={() => {}}
              >
                <span />
              </Form>
            </div>
          </div>
        )}
      </div>
    </PhoneFrame>
  )
}
