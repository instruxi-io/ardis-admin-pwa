/**
 * Schema preview components for the Catalogue import panel.
 *
 * OrderFormPreview  — lives in schema-preview-order.tsx and mirrors the app's
 *                     ui:groups wizard rule; re-exported here so existing
 *                     imports are unaffected.
 * CredentialPreview — read-only RJSF render of data_schema + ui_schema with the
 *                     sample payload, matching what JsonSchemaForm renders.
 */

import Form from '@rjsf/core'
import validator from '@rjsf/validator-ajv8'
import { ardisWidgets, ardisTemplates } from './rjsf-theme'
import { PhoneFrame } from './phone-frame'
import { Layers, ShieldCheck } from 'lucide-react'

export { OrderFormPreview } from './schema-preview-order'

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
              schema={schema as never}
              uiSchema={{ ...uiSchema, 'ui:readonly': true } as never}
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
                schema={schema as never}
                uiSchema={uiSchema as never}
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
