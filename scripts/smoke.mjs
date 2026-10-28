import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { run } from './build-toolcache.mjs';

const pins = JSON.parse(readFileSync(new URL('../pins.json', import.meta.url), 'utf8'));
const candidate = process.argv[2];
assert.ok(candidate, 'Pass a locally loaded candidate image');
const volume = `toolchain-smoke-${randomUUID()}`;
run('docker', ['volume', 'create', volume]);
try {
  // Copy only /toolcache, preserving symlinks/modes. No runner or host cache is copied.
  run('docker', ['run', '--rm', '--network=none', '--mount', `type=volume,src=${volume},dst=/payload`, candidate,
    'cp', '-a', '/toolcache/.', '/payload/']);
  run('docker', ['pull', '--platform=linux/amd64', pins.runnerImage]);
  // Root cannot write through this read-only mount either.
  run('docker', ['run', '--rm', '--network=none', '--user=0',
    '--mount', `type=volume,src=${volume},dst=/opt/hostedtoolcache,readonly`,
    '--entrypoint', '/bin/bash', pins.runnerImage, '-ec',
    'if touch /opt/hostedtoolcache/root-write 2>/tmp/write-error; then exit 1; fi; grep -q "Read-only file system" /tmp/write-error']);
  run('docker', ['run', '--rm', '--network=none', '--platform=linux/amd64',
    '--mount', `type=volume,src=${volume},dst=/opt/hostedtoolcache,readonly`,
    '--mount', `type=bind,src=${resolve('.')},dst=/smoke,readonly`,
    '--tmpfs', '/tmp:rw,mode=1777', '--workdir', '/tmp',
    '--env', 'HOME=/tmp/home', '--env', 'RUNNER_TOOL_CACHE=/opt/hostedtoolcache',
    '--entrypoint', `/opt/hostedtoolcache/node/${pins.node.version}/x64/bin/node`,
    pins.runnerImage, '/smoke/scripts/inside-smoke.mjs']);
} finally {
  run('docker', ['volume', 'rm', volume]);
}
