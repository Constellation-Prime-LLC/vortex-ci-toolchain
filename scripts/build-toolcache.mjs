// Layout adapted from Vortex infra/ci-runners/seed-tools.mjs (D6).
// No setup.sh, pip invocation, package manager, or executable from an unchecked archive.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const pins = JSON.parse(readFileSync(new URL('../pins.json', import.meta.url), 'utf8'));
export function verify(bytes, pin) {
  if (!/^[a-f0-9]{64}$/.test(pin.sha256) || createHash('sha256').update(bytes).digest('hex') !== pin.sha256) {
    throw new Error('Archive SHA-256 mismatch');
  }
  return bytes;
}
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.message ?? result.status}`);
  return result;
}
export function assertContainedTree(root) {
  const boundary = realpathSync(root);
  function walk(path) {
    const actual = realpathSync(path);
    if (actual !== boundary && !actual.startsWith(`${boundary}${sep}`)) throw new Error('Archive link escapes toolcache');
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return; // realpath above also rejects dangling/escaping links.
    if (stat.isDirectory()) for (const name of readdirSync(path)) walk(join(path, name));
    else if (!stat.isFile()) throw new Error('Special file in toolcache');
  }
  walk(root);
}
export const payloadMode = mode => mode & 0o755; // Keep executable bits; remove special and group/world write bits.
export function normalizeTreeModes(root) {
  assertContainedTree(root);
  function walk(path) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return; // Never chmod through a symlink.
    chmodSync(path, payloadMode(stat.mode));
    if (stat.isDirectory()) for (const name of readdirSync(path)) walk(join(path, name));
  }
  walk(root);
}
export async function build(cache, bootstrapArchive) {
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Build on linux/amd64');
  if (existsSync(cache)) throw new Error('Output must not exist');
  // Verify both archives before extraction into the payload.
  const nodeBytes = verify(readFileSync(bootstrapArchive), pins.node);
  const response = await fetch(pins.python.url, { signal: AbortSignal.timeout(300_000) });
  if (!response.ok) throw new Error(`Python download failed: ${response.status}`);
  const pythonBytes = verify(Buffer.from(await response.arrayBuffer()), pins.python);
  const pythonArchive = '/tmp/python.tar.gz';
  writeFileSync(pythonArchive, pythonBytes);
  const node = join(cache, 'node', pins.node.version, 'x64');
  const python = join(cache, 'Python', pins.python.version, 'x64');
  for (const path of [node, python]) mkdirSync(path, { recursive: true });
  // Extract exact modes and symlinks, then normalize modes before executing any payload.
  // Ownership is normalized to build root.
  run('tar', ['--no-same-owner', '--same-permissions', '-xzf', bootstrapArchive, '--strip-components=1', '-C', node]);
  run('tar', ['--no-same-owner', '--same-permissions', '-xzf', pythonArchive, '-C', python]);
  rmSync(join(python, 'setup.sh'));
  for (const [path, target] of [['python', './bin/python3.13'], ['bin/python', 'python3.13'], ['bin/python313', 'python3.13']]) {
    if (!existsSync(join(python, path))) symlinkSync(target, join(python, path));
  }
  normalizeTreeModes(cache);
  run(join(node, 'bin/node'), ['-e', `if(process.version !== 'v${pins.node.version}') throw Error('Node version mismatch')`]);
  run(join(python, 'bin/python'), ['-c', `import sys, ssl, sqlite3, bz2, lzma, ctypes; assert sys.version_info[:3] == tuple(map(int, '${pins.python.version}'.split('.')))`], {
    env: { ...process.env, LD_LIBRARY_PATH: join(python, 'lib'), PYTHONDONTWRITEBYTECODE: '1' },
  });
  // Complete markers appear only after layout, link, execution and ABI checks succeed.
  for (const path of [node, python]) writeFileSync(`${path}.complete`, '', { mode: 0o644 });
  console.log(JSON.stringify({ nodeArchiveBytes: nodeBytes.length, pythonArchiveBytes: pythonBytes.length }));
  run('du', ['-sb', cache]);
  rmSync(pythonArchive);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await build(process.argv[2], process.argv[3]);
}
