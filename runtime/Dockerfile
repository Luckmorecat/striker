ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ARG BASELINE_ID
LABEL org.striker.baseline=${BASELINE_ID}
RUN apt-get update && apt-get install -y --no-install-recommends git bash ripgrep curl ca-certificates build-essential python3 && rm -rf /var/lib/apt/lists/*
COPY baseline.json install.mjs probe.mjs /opt/striker/
RUN node /opt/striker/install.mjs
COPY gateway-bridge.mjs harness-config.mjs pi-search.mjs search-mcp.mjs context-config.mjs pi-launch.mjs /opt/striker/
COPY restrict-stage.c /opt/striker/
RUN chmod 755 /opt/striker/pi-launch.mjs && cc -O2 -Wall -Wextra -Werror /opt/striker/restrict-stage.c -o /opt/striker/restrict-stage
ENV HOME=/state PATH=/state/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
USER 1000:1000
WORKDIR /workspace
CMD ["sleep", "infinity"]
