import assert from 'node:assert/strict';

// We publish one linux/amd64 manifest. Refuse an unexpected index or platform.
export function previousDigest(manifest) {
  assert.ok(!Array.isArray(manifest), 'Expected a single-platform manifest');
  const descriptor = manifest.Descriptor;
  assert.equal(descriptor?.platform?.os, 'linux');
  assert.equal(descriptor?.platform?.architecture, 'amd64');
  assert.match(descriptor?.digest ?? '', /^sha256:[a-f0-9]{64}$/);
  return descriptor.digest;
}
