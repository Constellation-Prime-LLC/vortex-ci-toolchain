# Bootstrap and smoke use the same reviewed Ubuntu 24.04 runner ABI.
FROM ghcr.io/actions/actions-runner:2.338.0@sha256:4ffadc0002b2581327e06101fc8c06cd189232baf79fe561fac9caeb76f5e807 AS build
USER root
# The bootstrap is checksum-verified by Docker before tar or Node executes.
ADD --checksum=sha256:6e1db87ef58b8819e5d5402eff1536491b18edd8eb7bee5ef7897876e88dc5ff https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-x64.tar.gz /tmp/node.tar.gz
RUN mkdir /bootstrap && tar --no-same-owner -xzf /tmp/node.tar.gz --strip-components=1 -C /bootstrap
COPY pins.json /builder/pins.json
COPY scripts/build-toolcache.mjs /builder/scripts/build-toolcache.mjs
RUN /bootstrap/bin/node /builder/scripts/build-toolcache.mjs /toolcache /tmp/node.tar.gz

# This image carries tools, not a runner; cp -a supports the approved init-copy fallback.
FROM busybox:1.37.0@sha256:bdf57e528e45e4433820e045b29b4597825a1c9e38353532d90a01445013f82e
COPY --from=build /toolcache /toolcache
LABEL org.opencontainers.image.source="https://github.com/Constellation-Prime-LLC/vortex-ci-toolchain"
CMD ["cp", "--help"]
