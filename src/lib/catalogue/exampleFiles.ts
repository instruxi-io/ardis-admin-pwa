/**
 * The worked example a vendor is handed on first run.
 *
 * In lib rather than inline in the page so a test can assert on the exact thing
 * they receive. The previous starter emitted the legacy combined shape — no
 * x-publishes, x-version on a product — so the template we handed out was the
 * format we had moved away from, and nothing would have caught that.
 */

/** Files are three concatenated JSON objects: schema, UI schema, sample data. */
function serialise(objects: unknown[]): string {
  return objects.map(o => JSON.stringify(o, null, 2)).join('\n')
}

export interface ExampleFile {
  id: string
  name: string
  raw: string
}

export function exampleFiles(verifierId: string): ExampleFile[] {
  const vid = verifierId || 'your-verifier-id'

  const credential = [
    {
      'x-publishes': 'credential-schema',
      $id: `${vid}/example-check/v1`,
      title: 'Example Check Credential',
      description: 'What your verification returns. This is what the card shows.',
      'x-verifier-id': vid,
      'x-credential-type': 'example-check',
      'x-version': 'v1',
      type: 'object',
      required: ['reference_id', 'records'],
      properties: {
        reference_id: { type: 'string', title: 'Your Reference' },
        records: {
          type: 'array',
          title: 'Results',
          items: {
            type: 'object',
            properties: {
              subject_name: { type: 'string', title: 'Name' },
              status: { type: 'string', title: 'Status' },
              checked_on: { type: 'string', title: 'Checked', format: 'date' },
            },
          },
        },
      },
    },
    // reference_id is declared but left out of ui:groups, which is how a field is
    // deliberately kept off the card. Worth demonstrating, since it is the only
    // way to hide one and nothing else would teach it.
    { 'ui:groups': [{ title: 'Results', fields: ['records'] }] },
    {
      reference_id: 'your-internal-id',
      records: [{ subject_name: 'Alex Doe', status: 'Clear', checked_on: '2026-07-29' }],
    },
  ]

  const product = [
    {
      'x-publishes': 'product',
      $id: `${vid}/example-check`,
      title: 'Example Check',
      description: 'What a buyer is purchasing.',
      'x-verifier-id': vid,
      'x-verifier-name': 'Your Company',
      'x-sku': 'example-check',
      'x-credential-type': 'example-check',
      'x-order-type': 'example-check',
      'x-price-one-time': 2500,
      'x-price-currency': 'usd',
      type: 'object',
      required: ['subject_name'],
      properties: {
        subject_name: { type: 'string', title: 'Full Name' },
        notes: { type: 'string', title: 'Notes' },
      },
    },
    { 'ui:order': ['subject_name', 'notes'], notes: { 'ui:widget': 'textarea' } },
    { subject_name: 'Alex Doe', notes: '' },
  ]

  // Credential first: it is the order the batch publishes in, and seeing the
  // schema selected first matches the order the panel explains them in.
  return [
    { id: 'example-credential', name: `${vid}_example-check_v1.credential.json`, raw: serialise(credential) },
    { id: 'example-product', name: `${vid}_example-check.product.json`, raw: serialise(product) },
  ]
}
