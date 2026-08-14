/**
 * The prefilled product file offered on a schema that nothing sells yet.
 *
 * A published schema with no product is a dead end the vendor was previously
 * told to fix by authoring a file from scratch. This hands them one that is
 * already valid for THEIR schema, so the path from "orderable warning" to
 * "published product" is edit-a-title, not learn-a-format.
 */

function serialise(objects: unknown[]): string {
  return objects.map(o => JSON.stringify(o, null, 2)).join('\n')
}

// "provider-background-check" -> "Provider Background Check"
export function humanise(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1))
    .join(' ')
}

export function starterProductFile(
  verifierId: string,
  credentialType: string,
  verifierName?: string,
): { id: string; name: string; raw: string } {
  const title = humanise(credentialType)
  const product = [
    {
      'x-publishes': 'product',
      $id: `${verifierId}/${credentialType}`,
      title,
      description: `Orderable ${title.toLowerCase()} verification.`,
      'x-verifier-id': verifierId,
      'x-verifier-name': verifierName || verifierId,
      'x-sku': credentialType,
      'x-credential-type': credentialType,
      'x-order-type': credentialType,
      // Deliberately free: an accidental free publish is recoverable, an
      // accidental price is a refund. The pricing step explains how to charge.
      type: 'object',
      required: ['reference_id'],
      properties: {
        reference_id: {
          type: 'string',
          title: 'Your Reference',
          description: 'An internal id so you can match the result to your records',
        },
        notes: { type: 'string', title: 'Notes for the verifier' },
      },
    },
    { 'ui:order': ['reference_id', 'notes'], notes: { 'ui:widget': 'textarea' } },
    { reference_id: 'your-internal-id', notes: '' },
  ]
  return {
    id: `starter-product-${verifierId}-${credentialType}`,
    name: `${verifierId}_${credentialType}.product.json`,
    raw: serialise(product),
  }
}
