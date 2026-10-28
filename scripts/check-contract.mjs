import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pins } from './build-toolcache.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const dockerfile = read('Dockerfile');
const workflow = read('.github/workflows/build.yml');
for (const image of [pins.runnerImage, pins.payloadBase]) {
  assert.match(image, /@sha256:[a-f0-9]{64}$/);
  assert.ok(dockerfile.includes(`FROM ${image}`));
}
for (const tool of ['node', 'python']) {
  assert.match(pins[tool].version, /^\d+\.\d+\.\d+$/);
  assert.match(pins[tool].sha256, /^[a-f0-9]{64}$/);
  assert.ok(pins[tool].url.includes(pins[tool].version));
  assert.equal(new URL(pins[tool].url).protocol, 'https:');
}
assert.equal(pins.node.url, `https://nodejs.org/dist/v${pins.node.version}/node-v${pins.node.version}-linux-x64.tar.gz`);
assert.match(pins.python.url, /^https:\/\/github.com\/actions\/python-versions\/releases\/download\/\d+\.\d+\.\d+-\d+\/python-\d+\.\d+\.\d+-linux-24\.04-x64\.tar\.gz$/);
assert.ok(dockerfile.includes(`ADD --checksum=sha256:${pins.node.sha256} ${pins.node.url} /tmp/node.tar.gz`));
assert.ok(workflow.includes(`node-version: ${pins.node.version}`));
assert.ok(workflow.includes(`actions/setup-node@${pins.setupNode}`));
assert.ok(workflow.includes(`ref: ${pins.setupNode}`));
assert.ok(workflow.includes(`ref: ${pins.setupPython}`));
for (const action of workflow.matchAll(/uses:\s*(\S+)/g)) assert.match(action[1], /^[\w-]+\/[\w-]+(?:\/[\w-]+)?@[a-f0-9]{40}$/);
for (const source of dockerfile.matchAll(/^FROM\s+(\S+)/gm)) assert.match(source[1], /@sha256:[a-f0-9]{64}$/);
assert.ok(!/^#\s*syntax=/m.test(dockerfile), 'No unpinned Dockerfile frontend');
assert.ok(workflow.includes('github.ref_protected'));
assert.ok(workflow.includes('needs: [build, smoke]'));
for (const permission of ['contents: read', 'packages: write', 'id-token: write', 'attestations: write']) assert.ok(workflow.includes(permission));
const renovate = JSON.parse(read('renovate.json'));
for (const manager of renovate.customManagers) {
  assert.ok(manager.matchStrings.some(pattern => new RegExp(pattern).test(read('pins.json'))));
}
console.log('Docker inputs, bootstrap checksum, setup revisions, publishing gate and update matchers agree');
