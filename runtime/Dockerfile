ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ARG BASELINE_ID
LABEL org.striker.baseline=${BASELINE_ID}
RUN apt-get update && apt-get install -y --no-install-recommends git bash ripgrep curl ca-certificates build-essential python3 && rm -rf /var/lib/apt/lists/*
COPY baseline.json install.mjs probe.mjs /opt/striker/
RUN node /opt/striker/install.mjs
ENV HOME=/state PATH=/state/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
USER 1000:1000
WORKDIR /workspace
CMD ["sleep", "infinity"]
