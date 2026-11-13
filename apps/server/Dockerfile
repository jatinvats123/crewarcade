# CrewArcade server: API + webhooks + job workers + headless playtest worker, one Render service.
# Build from the repo root:  docker build -f apps/server/Dockerfile -t crewarcade-server .
# The base image ships Chromium for Playwright; its tag MUST match packages/engine's playwright
# version (a test in apps/server enforces this).
FROM mcr.microsoft.com/playwright:v1.64.1-noble AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
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
