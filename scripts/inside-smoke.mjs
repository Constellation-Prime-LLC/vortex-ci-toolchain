// Executed inside the exact pinned runner, with no network and no host toolcache.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const pins = JSON.parse(readFileSync('/smoke/pins.json', 'utf8'));
const cache = '/opt/hostedtoolcache';
const node = `${cache}/node/${pins.node.version}/x64`;
const python = `${cache}/Python/${pins.python.version}/x64`;
const actionRuntime = '/home/runner/externals/node20/bin/node'; // Both pinned action.yml files declare node20.
assert.equal(process.env.AGENT_TOOLSDIRECTORY, undefined, 'AGENT_TOOLSDIRECTORY must be unset');
assert.equal(process.env.RUNNER_TOOL_CACHE, cache);
for (const path of [node, python]) assert.equal(statSync(`${path}.complete`).size, 0);
for (const directory of ['/tmp/home', '/tmp/workspace', '/tmp/runner']) mkdirSync(directory, { recursive: true });

// @actions/core writes multiline command files. Parse only the requested field.
function field(file, key) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(`${key}=`)) return lines[i].slice(key.length + 1);
    if (lines[i].startsWith(`${key}<<`)) {
      const delimiter = lines[i].slice(key.length + 2), value = [];
      while (++i < lines.length && lines[i] !== delimiter) value.push(lines[i]);
      return value.join('\n');
    }
  }
}
function setup(tool, version) {
  const work = `/tmp/${tool}-${version}`;
  mkdirSync(work);
  for (const name of ['path', 'env', 'output', 'state']) writeFileSync(`${work}/${name}`, '');
  const result = spawnSync(actionRuntime, [`/smoke/.local/actions/setup-${tool}/dist/setup/index.js`], {
    cwd: '/tmp/workspace', encoding: 'utf8', timeout: 60_000,
    env: {
      ...process.env,
      GITHUB_PATH: `${work}/path`, GITHUB_ENV: `${work}/env`, GITHUB_OUTPUT: `${work}/output`, GITHUB_STATE: `${work}/state`,
      'INPUT_NODE-VERSION': tool === 'node' ? version : '',
      'INPUT_PYTHON-VERSION': tool === 'python' ? version : '',
      INPUT_ARCHITECTURE: 'x64', 'INPUT_CHECK-LATEST': 'false',
      'INPUT_UPDATE-ENVIRONMENT': 'true', 'INPUT_ALLOW-PRERELEASES': 'false', INPUT_FREETHREADED: 'false',
      'INPUT_PACKAGE-MANAGER-CACHE': 'false', INPUT_CACHE: '', INPUT_TOKEN: '',
      // Missing versions use a closed local proxy to fail promptly, even if DNS retries.
      ...(version === '0.0.0' ? { HTTPS_PROXY: 'http://127.0.0.1:9', HTTP_PROXY: 'http://127.0.0.1:9' } : {}),
      RUNNER_TEMP: '/tmp/runner', RUNNER_OS: 'Linux', RUNNER_ARCH: 'X64',
      GITHUB_WORKSPACE: '/tmp/workspace', ACTIONS_STEP_DEBUG: 'true',
    },
  });
  if (result.error) throw result.error; // A timeout/crash is never a valid negative result.
  const log = `${result.stdout}\n${result.stderr}`;
  console.log(log);
  return { ...result, log, work };
}

// Mount-level refusal, including root, is tested by the outer smoke harness too.
assert.throws(() => writeFileSync(`${cache}/smoke-write`, 'must fail'), error => ['EROFS', 'EACCES'].includes(error.code));
const nodeHit = setup('node', pins.node.version);
assert.equal(nodeHit.status, 0);
assert.ok(nodeHit.log.includes(`Found in cache @ ${node}`));
assert.equal(readFileSync(`${nodeHit.work}/path`, 'utf8').trim(), `${node}/bin`);
console.log(`setup-node cache hit: ${node}`);
const pythonHit = setup('python', pins.python.version);
assert.equal(pythonHit.status, 0);
assert.ok(pythonHit.log.includes(`Successfully set up CPython (${pins.python.version})`));
assert.ok(!pythonHit.log.includes('was not found in the local cache'));
assert.equal(field(`${pythonHit.work}/output`, 'python-path'), `${python}/bin/python`);
assert.equal(field(`${pythonHit.work}/output`, 'python-version'), pins.python.version);
assert.equal(field(`${pythonHit.work}/env`, 'pythonLocation'), python);
assert.equal(field(`${pythonHit.work}/env`, 'LD_LIBRARY_PATH'), `${python}/lib`);
// Success with --network=none and a read-only cache proves Python's cache-hit path.
console.log(`setup-python cache hit: ${python}`);
assert.equal(realpathSync(`${python}/bin/python`), `${python}/bin/python3.13`);
assert.equal(process.execPath, `${node}/bin/node`);
assert.equal(process.version, `v${pins.node.version}`);
const pythonCheck = spawnSync(`${python}/bin/python`, ['-c',
  `import sys, ssl, sqlite3, bz2, lzma, ctypes; assert sys.version_info[:3] == tuple(map(int, '${pins.python.version}'.split('.'))); assert sys.prefix == '${python}'; print(sys.version.split()[0]); print(sys.executable)`], {
  encoding: 'utf8', env: { ...process.env, LD_LIBRARY_PATH: `${python}/lib`, PYTHONDONTWRITEBYTECODE: '1' },
});
assert.equal(pythonCheck.status, 0, pythonCheck.stderr);
console.log(pythonCheck.stdout);
for (const tool of ['node', 'python']) {
  const miss = setup(tool, '0.0.0');
  assert.equal(miss.status, 1, `${tool} missing version must fail normally`);
  assert.ok(!miss.log.includes('Found in cache @'));
  if (tool === 'python') assert.ok(miss.log.includes('Version 0.0.0 was not found in the local cache'));
  console.log(`setup-${tool} missing-version refusal confirmed`);
}
console.log('Pinned runner ABI, cache hits, markers, paths and missing-version checks passed');
