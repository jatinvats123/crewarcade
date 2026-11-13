# CrewArcade server: API + webhooks + job workers + headless playtest worker, one Render service.
# Build from the repo root:  docker build -f apps/server/Dockerfile -t crewarcade-server .
# The base image ships Chromium for Playwright; its tag MUST match packages/engine's playwright
# version (a test in apps/server enforces this).
# That image ships Node 26 (no corepack); we run Node 22 LTS, copied from the official image into
# /usr/local, which comes before the image's /usr/bin/node on PATH.
FROM node:22.23.5-bookworm-slim AS node22

FROM mcr.microsoft.com/playwright:v1.64.1-noble AS base
COPY --from=node22 /usr/local/bin/node /usr/local/bin/node
COPY --from=node22 /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf ../lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack \
 && ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && node -v | grep -q '^v22\.'
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:/usr/local/bin:$PATH \
    CI=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY packages/engine/package.json packages/engine/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter "@crewarcade/server..."
COPY packages/engine packages/engine
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN pnpm --filter @crewarcade/server build \
 && pnpm --filter @crewarcade/server deploy --prod --legacy /app

FROM base AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY --from=build --chown=pwuser:pwuser /app /app
USER pwuser
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/index.js"]
