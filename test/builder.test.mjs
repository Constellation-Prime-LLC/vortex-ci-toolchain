import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertContainedTree, verify } from '../scripts/build-toolcache.mjs';
import { previousDigest } from '../scripts/registry-manifest.mjs';

test('checksum accepts the exact archive and rejects corruption or invalid hashes', () => {
  const archive = Buffer.from('synthetic archive fixture');
  const pin = { sha256: createHash('sha256').update(archive).digest('hex') };
  assert.equal(verify(archive, pin), archive);
  assert.throws(() => verify(Buffer.concat([archive, Buffer.from('x')]), pin), /SHA-256/);
  assert.throws(() => verify(archive, { sha256: '' }), /SHA-256/);
});

test('payload containment accepts internal aliases and rejects escaping and dangling links', () => {
  const root = mkdtempSync(join(tmpdir(), 'toolchain-links-'));
  try {
    const cache = join(root, 'cache');
    mkdirSync(cache);
    mkdirSync(join(cache, 'bin'));
    writeFileSync(join(cache, 'bin/python3.13'), 'synthetic executable');
    // Directory junctions work without Windows symlink privileges and exercise the same containment check.
    symlinkSync(join(cache, 'bin'), join(cache, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.doesNotThrow(() => assertContainedTree(cache));
    const outside = join(root, 'outside');
    mkdirSync(outside);
    symlinkSync(outside, join(cache, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => assertContainedTree(cache), /escapes toolcache/);
    rmSync(join(cache, 'escape'));
    symlinkSync(join(root, 'absent'), join(cache, 'dangling'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => assertContainedTree(cache), /ENOENT/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('retention accepts only an immutable linux amd64 single manifest', () => {
  const digest = `sha256:${'a'.repeat(64)}`;
  const manifest = { Descriptor: { digest, platform: { os: 'linux', architecture: 'amd64' } } };
  assert.equal(previousDigest(manifest), digest);
  assert.throws(() => previousDigest([manifest]), /single-platform/);
  assert.throws(() => previousDigest({ Descriptor: { ...manifest.Descriptor, digest: 'current' } }));
  assert.throws(() => previousDigest({ Descriptor: { ...manifest.Descriptor, platform: { os: 'linux', architecture: 'arm64' } } }));
  assert.throws(() => previousDigest({}));
});
