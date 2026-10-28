import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, lstatSync, mkdtempSync, mkdirSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertContainedTree, normalizeTreeModes, payloadMode, verify } from '../scripts/build-toolcache.mjs';
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

test('payload modes remove group/world writes and special bits while retaining all executable bits', () => {
  assert.equal(payloadMode(0o777), 0o755);
  assert.equal(payloadMode(0o666), 0o644);
  for (let mode = 0; mode <= 0o7777; mode++) {
    const normalized = payloadMode(mode);
    assert.equal(normalized & 0o7022, 0);
    assert.equal(normalized & 0o111, mode & 0o111);
    assert.equal(normalized & 0o644, mode & 0o644);
    assert.equal(payloadMode(normalized), normalized);
  }
});

test('tree normalization keeps symlinks, executable files and read-only files intact', { skip: process.platform === 'win32' && 'POSIX modes require Linux CI' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'toolchain-modes-'));
  try {
    const bin = join(root, 'bin');
    mkdirSync(bin);
    const executable = join(bin, 'python');
    const data = join(root, 'data');
    const readonly = join(root, 'readonly');
    for (const path of [executable, data, readonly]) writeFileSync(path, 'fixture');
    for (const [path, mode] of [[root, 0o777], [bin, 0o777], [executable, 0o777], [data, 0o666], [readonly, 0o444]]) chmodSync(path, mode);
    symlinkSync('bin/python', join(root, 'python'));
    symlinkSync('bin', join(root, 'alias'));
    normalizeTreeModes(root);
    for (const [path, mode] of [[root, 0o755], [bin, 0o755], [executable, 0o755], [data, 0o644], [readonly, 0o444]]) assert.equal(statSync(path).mode & 0o7777, mode);
    for (const name of ['python', 'alias']) assert.ok(lstatSync(join(root, name)).isSymbolicLink());
    assert.equal(readlinkSync(join(root, 'python')), 'bin/python');
    assert.equal(readlinkSync(join(root, 'alias')), 'bin');
    normalizeTreeModes(root); // Idempotent on a second pass.
    assert.equal(statSync(executable).mode & 0o7777, 0o755);
    symlinkSync(tmpdir(), join(root, 'escape'));
    assert.throws(() => normalizeTreeModes(root), /escapes toolcache/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
