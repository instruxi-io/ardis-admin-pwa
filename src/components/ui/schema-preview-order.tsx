/**
 * Order form preview.
 *
 * `ui:groups` is our own extension, so RJSF ignores it. Previewing through RJSF
 * alone rendered every product as one flat scroll, while the app reads
 * `ui:groups` directly and switches to a multi-step wizard at two or more groups
 * (catalogue_product_screen.dart). A 19-field subscription therefore showed here
 * as a single page and on the device as six screens, which is exactly the flow a
 * vendor most needs to check before publishing. This mirrors the app's rule.
 */

import { useState } from 'react'
import Form from '@rjsf/core'
import validator from '@rjsf/validator-ajv8'
import { ardisWidgets, ardisTemplates } from './rjsf-theme'
import { PhoneFrame } from './phone-frame'

interface Step {
  title: string
  fields: string[]
}

function stepsFrom(
  uiSchema: Record<string, unknown>,
  properties: Record<string, unknown>,
): Step[] {
  const raw = uiSchema['ui:groups']
  if (!Array.isArray(raw)) return []
  return raw
    .filter((g): g is Record<string, unknown> => !!g && typeof g === 'object')
    .map(g => ({
      title: (g.title as string) ?? '',
      // Drop fields the schema does not define, as the app does, so a stale
      // group entry cannot produce an empty step.
      fields: (((g.fields as string[]) ?? []) as string[]).filter(f => f in properties),
    }))
    .filter(step => step.fields.length > 0)
}

/** Schema narrowed to one step, so RJSF renders that step and nothing else. */
function sliceSchema(
  schema: Record<string, unknown>,
  fields: string[],
): Record<string, unknown> {
  const props = (schema.properties as Record<string, unknown>) ?? {}
  return {
    ...schema,
    type: 'object',
    properties: Object.fromEntries(
      fields.filter(f => f in props).map(f => [f, props[f]]),
    ),
    required: (((schema.required as string[]) ?? []) as string[]).filter(f =>
      fields.includes(f),
    ),
  }
}

function sliceUi(
  uiSchema: Record<string, unknown>,
  fields: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) if (f in uiSchema) out[f] = uiSchema[f]
  // Within a step the group's own ordering is the intended one.
  out['ui:order'] = fields
  return out
}

/** Mirrors the app's per-step gate, which is what stops Next advancing. */
function stepComplete(
  schema: Record<string, unknown>,
  step: Step,
  formData: Record<string, unknown>,
): boolean {
  const required = (((schema.required as string[]) ?? []) as string[]).filter(f =>
    step.fields.includes(f),
  )
  return required.every(f => {
    const v = formData[f]
    if (v === undefined || v === null) return false
    if (typeof v === 'string') return v.trim() !== ''
    if (Array.isArray(v)) return v.length > 0
    return true
  })
}

export function OrderFormPreview({
  schema,
  uiSchema,
}: {
  schema: Record<string, unknown>
  uiSchema: Record<string, unknown>
}) {
  const [formData, setFormData] = useState<Record<string, unknown>>({})
  const [hasErrors, setHasErrors] = useState(false)
  const [step, setStep] = useState(0)

  const properties = (schema.properties as Record<string, unknown>) ?? {}
  const steps = stepsFrom(uiSchema, properties)
  const isWizard = steps.length >= 2

  // Clamped rather than reset: editing the JSON can remove a group while a later
  // step is open, and snapping back to the first step on every keystroke would
  // make the preview unusable while authoring.
  const current = isWizard ? Math.min(step, steps.length - 1) : 0
  const activeStep = isWizard ? steps[current] : null

  const stepSchema = activeStep ? sliceSchema(schema, activeStep.fields) : schema
  const stepUi = activeStep ? sliceUi(uiSchema, activeStep.fields) : uiSchema

  const canAdvance = activeStep
    ? stepComplete(schema, activeStep, formData) && !hasErrors
    : !hasErrors
  const isLast = !isWizard || current === steps.length - 1

  return (
    <PhoneFrame title={isWizard ? `Order Form · ${steps.length} steps` : 'Order Form'}>
      <div className="space-y-4">
        {isWizard ? (
          <div className="space-y-2">
            {/* The app shows progress, so the preview must too, or a vendor
                cannot tell how deep into the flow a field sits. */}
            <div className="flex items-center gap-1">
              {steps.map((s, i) => (
                <button
                  key={`${s.title}-${i}`}
                  type="button"
                  title={s.title || `Step ${i + 1}`}
                  aria-label={`Go to step ${i + 1}: ${s.title}`}
                  onClick={() => setStep(i)}
                  className={`h-1 flex-1 rounded-full transition-colors ${
                    i <= current ? 'bg-[#C9A84C]' : 'bg-[#2a2a2a]'
                  }`}
                />
              ))}
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-white truncate">
                {activeStep?.title || `Step ${current + 1}`}
              </h2>
              <span className="text-[10px] text-[#6b7280] shrink-0 tabular-nums">
                {current + 1} of {steps.length}
              </span>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-white">Place Order</h2>
            <p className="text-[11px] text-[#6b7280]">
              Fill in the required information below
            </p>
          </div>
        )}

        <Form
          // Remounted per step so RJSF drops the error state of the step just
          // left, which would otherwise report those fields as still missing.
          key={isWizard ? `step-${current}` : 'flat'}
          schema={stepSchema as never}
          uiSchema={stepUi as never}
          formData={formData}
          validator={validator}
          widgets={ardisWidgets}
          templates={ardisTemplates}
          onChange={({ formData: d, errors }) => {
            // Merged, never replaced: the schema is narrowed to one step, so
            // assigning RJSF's formData wholesale would drop every value
            // entered on the others.
            setFormData(prev => ({ ...prev, ...((d as Record<string, unknown>) ?? {}) }))
            setHasErrors(errors.length > 0)
          }}
          onSubmit={() => {}}
          onError={() => setHasErrors(true)}
        >
          <span />
        </Form>

        <div className="flex items-center gap-2">
          {isWizard && current > 0 && (
            <button
              type="button"
              onClick={() => setStep(current - 1)}
              className="px-4 py-3 rounded-xl text-sm font-semibold bg-[#1c1c1c] text-[#9ca3af] hover:bg-[#242424] transition-colors"
            >
              Back
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (!isLast && canAdvance) setStep(current + 1)
            }}
            disabled={!canAdvance}
            className={`flex-1 py-3 rounded-xl text-sm font-semibold transition-colors ${
              !canAdvance
                ? 'bg-[#2a2a2a] text-[#6b7280] cursor-not-allowed'
                : 'bg-[#C9A84C] text-black hover:bg-[#b8973d]'
            }`}
          >
            {isLast ? 'Review Order' : 'Continue'}
          </button>
        </div>

        {isWizard && !canAdvance && (
          <p className="text-[10px] text-[#6b7280] text-center">
            Required fields on this step gate the next one, as they do in the app.
          </p>
        )}
      </div>
    </PhoneFrame>
  )
}
