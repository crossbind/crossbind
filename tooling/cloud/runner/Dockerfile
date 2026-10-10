# A crossbind cloud runner: the toolchain image crossbind pins for one role, and the runner of core/crossbind/src/runner.
# scripts/build-image.mjs writes the image and the role into the ARG lines, since wrangler passes no build arguments;
# wrangler builds for linux/amd64.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ARG BASE_IMAGE
ARG RUNNER_ROLE

USER root
COPY runner /opt/crossbind/runner
COPY entrypoint.sh /opt/crossbind/entrypoint.sh
RUN chmod 0755 /opt/crossbind/entrypoint.sh

# Python's requests reads its own CA bundle unless pointed at the system one, which the entrypoint extends.
ENV CROSSBIND_RUNNER_IMAGE=${BASE_IMAGE} CROSSBIND_RUNNER_ROLE=${RUNNER_ROLE} REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt
EXPOSE 8787
ENTRYPOINT ["/opt/crossbind/entrypoint.sh"]
