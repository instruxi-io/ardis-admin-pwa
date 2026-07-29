import { describe, expect, it } from 'vitest'
import { checkSchema } from './schemaChecks'

const form = { flagNestedObjects: true }
const display = { flagNestedObjects: false }

describe('checkSchema: the schema itself', () => {
  it('accepts a valid schema', () => {
    const r = checkSchema({ type: 'object', properties: { a: { type: 'string' } } }, undefined, form)
    expect(r.schemaValid).toBe(true)
    expect(r.schemaError).toBeUndefined()
  })

  // Previously only `type === 'object'` at the root and the presence of
  // `properties` were checked, so a typo on a nested field passed validation and
  // surfaced as a broken preview instead.
  it('rejects a misspelled type on a nested field', () => {
    const r = checkSchema(
      { type: 'object', properties: { a: { type: 'objekt' } } }, undefined, form)
    expect(r.schemaValid).toBe(false)
    expect(r.schemaError).toBeTruthy()
    // The message should point at the offending path, not just say "invalid".
    expect(r.schemaError).toContain('type')
  })

  it('rejects a malformed items', () => {
    const r = checkSchema(
      { type: 'object', properties: { a: { type: 'array', items: 5 } } }, undefined, form)
    expect(r.schemaValid).toBe(false)
  })

  it('does not attempt sample validation when the schema is invalid', () => {
    const r = checkSchema({ type: 'objekt' }, { a: 1 }, form)
    expect(r.sampleValid).toBeUndefined()
  })
})

describe('checkSchema: sample data', () => {
  const schema = {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string' },
      dob: { type: 'string', format: 'date' },
      count: { type: 'integer' },
      tier: { type: 'string', enum: ['standard', 'express'] },
    },
  }

  it('accepts data that fits', () => {
    const r = checkSchema(schema, { name: 'A', dob: '1985-04-12', count: 2, tier: 'standard' }, form)
    expect(r.sampleValid).toBe(true)
  })

  // The old check compared key names only, so every one of these passed here and
  // then failed in the preview pane beside it.
  it('catches a wrong type', () => {
    const r = checkSchema(schema, { name: 'A', count: 'two' }, form)
    expect(r.sampleValid).toBe(false)
    expect(r.sampleError).toContain('count')
  })

  it('catches a bad format', () => {
    const r = checkSchema(schema, { name: 'A', dob: 'last tuesday' }, form)
    expect(r.sampleValid).toBe(false)
  })

  it('catches a value outside an enum', () => {
    const r = checkSchema(schema, { name: 'A', tier: 'gold' }, form)
    expect(r.sampleValid).toBe(false)
  })

  it('catches a required field left blank', () => {
    const r = checkSchema(schema, { dob: '1985-04-12' }, form)
    expect(r.sampleValid).toBe(false)
  })

  // In form data an empty string means "not filled in": RJSF strips empties and
  // the Flutter form removes the key. Validating them would fail every optional
  // date or email field for being blank.
  it('treats an empty string as not filled in', () => {
    const r = checkSchema(schema, { name: 'A', dob: '' }, form)
    expect(r.sampleValid).toBe(true)
  })

  it('strips empties inside nested rows too', () => {
    const arr = {
      type: 'object',
      properties: {
        rows: {
          type: 'array',
          items: { type: 'object', properties: { when: { type: 'string', format: 'date' } } },
        },
      },
    }
    const r = checkSchema(arr, { rows: [{ when: '' }] }, form)
    expect(r.sampleValid).toBe(true)
  })

  // An absent sample and an empty one both mean "none supplied" — which is how
  // the RJSF playground's form-data pane starts.
  it('skips validation when no sample is supplied', () => {
    expect(checkSchema(schema, undefined, form).sampleValid).toBeUndefined()
    expect(checkSchema(schema, {}, form).sampleValid).toBeUndefined()
  })
})

describe('checkSchema: required must name real fields', () => {
  it('reports a required field that does not exist', () => {
    const r = checkSchema(
      { type: 'object', required: ['ghost', 'real'], properties: { real: { type: 'string' } } },
      undefined, form)
    expect(r.missingRequired).toEqual(['ghost'])
  })

  it('is quiet when every required field exists', () => {
    const r = checkSchema(
      { type: 'object', required: ['real'], properties: { real: { type: 'string' } } },
      undefined, form)
    expect(r.missingRequired).toEqual([])
  })
})

describe('checkSchema: constructs the app cannot render', () => {
  // The portal previews with real RJSF, which supports all of these. The Flutter
  // renderer branches on enum, boolean, array, date, then falls through to a text
  // field — so these preview correctly and render wrong on the phone.
  it('flags oneOf, anyOf, allOf and $ref at any depth', () => {
    for (const keyword of ['oneOf', 'anyOf', 'allOf', '$ref']) {
      const r = checkSchema(
        { type: 'object', properties: { a: { [keyword]: [] } } }, undefined, form)
      expect(r.unsupported.join(' '), keyword).toContain(keyword)
      expect(r.unsupported.join(' ')).toContain('a')
    }
  })

  it('flags a nested object in an order form, where it renders as one text box', () => {
    const r = checkSchema(
      { type: 'object', properties: { addr: { type: 'object', properties: { city: { type: 'string' } } } } },
      undefined, form)
    expect(r.unsupported.join(' ')).toContain('addr')
    expect(r.unsupported.join(' ')).toContain('nested object')
  })

  // A credential schema is read-only and the display renderer does handle nested
  // objects, so the same shape is fine there.
  it('allows a nested object in a credential schema', () => {
    const r = checkSchema(
      { type: 'object', properties: { provider_info: { type: 'object', properties: { name: { type: 'string' } } } } },
      undefined, display)
    expect(r.unsupported).toEqual([])
  })

  // Array items are rendered as rows of sub-fields, so an object there is the
  // supported case and must not be flagged.
  it('allows an object as array items even in an order form', () => {
    const r = checkSchema(
      {
        type: 'object',
        properties: {
          licences: { type: 'array', items: { type: 'object', properties: { state: { type: 'string' } } } },
        },
      },
      undefined, form)
    expect(r.unsupported).toEqual([])
  })

  it('is quiet on a schema using only supported constructs', () => {
    const r = checkSchema(
      {
        type: 'object',
        properties: {
          name: { type: 'string' },
          tier: { type: 'string', enum: ['a', 'b'] },
          rush: { type: 'boolean' },
          when: { type: 'string', format: 'date' },
        },
      },
      undefined, form)
    expect(r.unsupported).toEqual([])
  })
})

describe('checkSchema: a schema that declares $id', () => {
  // AJV caches compiled schemas by $id, and this is the same instance the preview
  // validates with. Compiling a schema with an $id registered it, so the second
  // compile — a re-render, or the other half of a pair — failed with "schema with
  // key or id already exists". A vendor saw that in place of a validation result.
  it('can be compiled repeatedly without colliding', () => {
    const schema = {
      $id: 'vendor1/background/v2',
      type: 'object',
      properties: { reference_id: { type: 'string' } },
    }
    for (let i = 0; i < 3; i++) {
      const r = checkSchema(schema, { reference_id: 'x' }, display)
      expect(r.schemaValid, `compile ${i + 1}`).toBe(true)
      expect(r.schemaError).toBeUndefined()
      expect(r.sampleValid).toBe(true)
    }
  })

  it('does not collide with a different schema reusing the same $id', () => {
    const a = { $id: 'same/id/v1', type: 'object', properties: { a: { type: 'string' } } }
    const b = { $id: 'same/id/v1', type: 'object', properties: { b: { type: 'number' } } }
    expect(checkSchema(a, { a: 'x' }, display).sampleValid).toBe(true)
    expect(checkSchema(b, { b: 1 }, display).sampleValid).toBe(true)
    // And the second must be validated against its own shape, not the first's.
    expect(checkSchema(b, { b: 'not a number' }, display).sampleValid).toBe(false)
  })
})
