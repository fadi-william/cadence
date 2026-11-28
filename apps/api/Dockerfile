# Build from the repository root:  docker build -f apps/api/Dockerfile -t cadence-api .
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/e2e/package.json apps/e2e/
COPY apps/site/package.json apps/site/
COPY packages/ui-theme/package.json packages/ui-theme/
RUN npm ci --ignore-scripts --workspace @cadence/api --workspace @cadence/shared --include-workspace-root
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @cadence/shared \
 && npx --workspace @cadence/api prisma generate \
 && npm run build -w @cadence/api

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/packages/shared packages/shared
COPY --from=build /repo/apps/api/package.json /repo/apps/api/prisma.config.ts apps/api/
COPY --from=build /repo/apps/api/prisma apps/api/prisma
COPY --from=build /repo/apps/api/dist apps/api/dist
WORKDIR /repo/apps/api
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://localhost:3000/api/health || exit 1
# Apply pending migrations, then start. Safe to run on every instance (Prisma takes an advisory lock).
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
