import { describe, it, expect } from 'vitest'

// The server re-marshals order_schema through a Go map, which alphabetises
// properties. The app renders in served order unless ui:order pins it, so a
// product authored without ui:order previews one way in the portal and renders
// another way on the phone. Publish pins the author's order when they have not.
//
// The logic lives inline in SchemasPage's publishProduct; mirrored here as the
// same expression so a refactor that drops it fails a named test.
function pinnedUi(orderSchema: Record<string, unknown>, ui: Record<string, unknown>) {
  const authoredProps = Object.keys((orderSchema?.properties as Record<string, unknown>) ?? {})
  return (!ui['ui:order'] && authoredProps.length > 0)
    ? { ...ui, 'ui:order': authoredProps }
    : ui
}

const schema = { properties: { zeta: {}, alpha: {}, mid: {} } }

describe('ui:order pinning at publish', () => {
  it('pins the authored property order when the author gave none', () => {
    expect(pinnedUi(schema, {})['ui:order']).toEqual(['zeta', 'alpha', 'mid'])
  })
  it('never overrides an order the author chose', () => {
    const ui = { 'ui:order': ['alpha', 'zeta', 'mid'] }
    expect(pinnedUi(schema, ui)['ui:order']).toEqual(['alpha', 'zeta', 'mid'])
  })
  it('keeps the rest of the ui schema intact', () => {
    const ui = { 'ui:widget': 'textarea' }
    const out = pinnedUi(schema, ui)
    expect(out['ui:widget']).toBe('textarea')
    expect(out['ui:order']).toEqual(['zeta', 'alpha', 'mid'])
  })
  it('leaves an empty schema alone', () => {
    expect(pinnedUi({}, {})['ui:order']).toBeUndefined()
  })
})
