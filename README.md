# Vortex CI toolchain

Public builder contract for `ghcr.io/constellation-prime-llc/vortex-ci-toolchain`, owned by Constellation Prime LLC. The image is Linux amd64 and contains only the minimal BusyBox base (including `cp -a`) and this payload:

```text
/toolcache/node/24.21.0/x64/          # bin/node and the complete upstream distribution
/toolcache/node/24.21.0/x64.complete
/toolcache/Python/3.13.15/x64/        # bin/python -> python3.13, libraries and upstream contents
/toolcache/Python/3.13.15/x64.complete
```

`pins.json` records archive URLs, SHA-256 hashes, base/runner digests and setup action revisions. Docker verifies the Node bootstrap before execution; the builder verifies both archives before payload extraction. The layout follows Vortex's reviewed `seed-tools.mjs`: Node strips one directory level, Python extracts directly, `setup.sh` is removed, and Python aliases are linked. No installer, pip upgrade or package installation runs. Tar and image copies preserve executable modes and symlinks; complete markers follow validation. The final base supplies copy tooling; execute the payload only inside the matching Ubuntu runner ABI.

Mount **only `/toolcache`** at `/opt/hostedtoolcache`, read-only in runner and dind. Set `RUNNER_TOOL_CACHE=/opt/hostedtoolcache` and leave `AGENT_TOOLSDIRECTORY` unset. HOME, workspace and temporary directories stay writable. Kubernetes image volumes use `subPath: toolcache`; the approved fallback copies with `cp -a /toolcache/. /destination/` in an init container, then mounts the destination read-only for consumers. A read-only mount does not protect against a compromised node or privileged dind. Nodes pre-pull and pin the digest separately; this repository performs no node operations.

The workflow runs only on pushes to protected `main` in `Constellation-Prime-LLC/vortex-ci-toolchain`. Build and smoke have read-only permissions; publishing alone has `contents: read`, `packages: write`, `id-token: write`, and `attestations: write`. The owner must create the public repository, protect `main` (review required, no force pushes or deletion), restrict workflow changes to trusted reviewers, enable Actions, and make the GHCR package public before consumers use it. No repository or package is provisioned by these files.

Build transfers the exact local image through a one-day workflow artifact. Smoke executes both pinned setup actions' bundled entry points inside the pinned runner with networking disabled and only the produced toolcache mounted at the cache path read-only; it checks cache-hit evidence, markers, exact versions/paths, Python ABI imports and deliberate missing-version failures. It also checks root write refusal. Publish pushes the tested image under `sha-<commit>`, obtains its registry digest and attaches GitHub build provenance to that digest. Only after attestation succeeds does `previous` retain the prior `current` digest and `current` advance. Immutable commit tags and both retention tags are never deleted by this workflow; configure no cleanup policy that removes them or their attestations. Consumers use `@sha256:…`, never a tag. Verify the attestation with `gh attestation verify oci://ghcr.io/constellation-prime-llc/vortex-ci-toolchain@sha256:… --repo Constellation-Prime-LLC/vortex-ci-toolchain` and review the recorded workflow identity and source commit before updating Vortex's digest.

Renovate proposes Node/Python releases, Docker digests and action revisions without automerge. Each Node/Python update requires a matching upstream archive URL and independently verified SHA-256, synchronized bootstrap/workflow pins, local checks and a successful pinned-runner smoke before review. Runner releases are monitored against their release date: update **inside 30 days**, immediately for critical updates (owner decision O16). Review the runner and Vortex `init-dind-externals` pins together; update dind separately. Each node change still requires the owner's explicit approval. Renovate notices are inputs to this deadline process, not a monthly substitute.

Local checks need Node 24 and no installed dependencies:

```sh
node scripts/check-contract.mjs
node --test
actionlint .github/workflows/build.yml
```

With Docker available, `docker build --platform linux/amd64 --provenance=false -t toolchain:candidate .` builds the payload. GitHub's attestation step supplies provenance after publication; disabling the implicit BuildKit attestation keeps the image a single-platform manifest. The workflow additionally checks out the two setup action repositories at the revisions in `pins.json` under `.local/actions/setup-node` and `.local/actions/setup-python` before `node scripts/smoke.mjs toolchain:candidate`. Both pinned actions declare the runner's bundled Node 20 runtime, which the smoke test uses; the produced Node 24 executes the harness and its own version checks. The smoke harness removes its temporary containers and volume. CI records archive, unpacked image/toolcache and compressed registry layer sizes, and the published digest.

The initial Windows authoring session cannot run Docker. Until the first CI run, image build/extraction, Linux symlink/mode preservation, runner execution/ABI, action cache hits and misses, read-only mount behavior, image sizes, GHCR publication/retention and attestation remain unverified. Kubernetes image-volume and nested dind execution require the separately approved P4 node probe even after CI smoke passes.
