// Outputs only the public immutable image name and digest, never credentials.
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { run } from './build-toolcache.mjs';
import { previousDigest } from './registry-manifest.mjs';

const image = 'ghcr.io/constellation-prime-llc/vortex-ci-toolchain';
const sha = process.env.GITHUB_SHA;
assert.match(sha ?? '', /^[a-f0-9]{40}$/);
assert.equal(process.env.GITHUB_REPOSITORY, 'Constellation-Prime-LLC/vortex-ci-toolchain');
assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
assert.equal(process.env.GITHUB_REF_PROTECTED, 'true');
const mode = process.argv[2];
const capture = args => run('docker', args, { stdio: 'pipe', encoding: 'utf8' }).stdout.trim();
if (mode === 'push') {
  run('docker', ['tag', 'toolchain:candidate', `${image}:sha-${sha}`]);
  run('docker', ['push', `${image}:sha-${sha}`]);
  const reference = JSON.parse(capture(['image', 'inspect', `${image}:sha-${sha}`, '--format', '{{json .RepoDigests}}']))
    .find(value => value.startsWith(`${image}@sha256:`));
  assert.ok(reference, 'Registry digest must be present');
  const digest = reference.split('@')[1];
  assert.match(digest, /^sha256:[a-f0-9]{64}$/);
  appendFileSync(process.env.GITHUB_OUTPUT, `digest=${digest}\n`);
  console.log(reference);
} else if (mode === 'retain') {
  const digest = process.env.IMAGE_DIGEST;
  assert.match(digest ?? '', /^sha256:[a-f0-9]{64}$/);
  // Resolve current by digest; never pull a mutable tag. A missing tag is expected only on first publication.
  const { spawnSync } = await import('node:child_process');
  const current = spawnSync('docker', ['manifest', 'inspect', `${image}:current`], { encoding: 'utf8' });
  if (current.error) throw current.error;
  if (current.status === 0) {
    const priorDigest = previousDigest(JSON.parse(capture(['manifest', 'inspect', '--verbose', `${image}:current`])));
    if (priorDigest !== digest) {
      run('docker', ['pull', `${image}@${priorDigest}`]);
      run('docker', ['tag', `${image}@${priorDigest}`, `${image}:previous`]);
      run('docker', ['push', `${image}:previous`]);
    }
  } else {
    assert.match(current.stderr, /manifest unknown|no such manifest|not found/i, 'Registry errors must fail closed');
  }
  run('docker', ['pull', `${image}@${digest}`]);
  run('docker', ['tag', `${image}@${digest}`, `${image}:current`]);
  run('docker', ['push', `${image}:current`]);
} else throw new Error('Expected push or retain');
