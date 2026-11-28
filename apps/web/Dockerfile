# Build from the repository root:  docker build -f apps/web/Dockerfile -t cadence-web .
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/e2e/package.json apps/e2e/
COPY apps/site/package.json apps/site/
COPY packages/ui-theme/package.json packages/ui-theme/
RUN npm ci --ignore-scripts --workspace @cadence/web --workspace @cadence/shared --include-workspace-root
COPY packages/shared packages/shared
COPY packages/ui-theme packages/ui-theme
COPY apps/web apps/web
RUN npm run build -w @cadence/shared && npm run build -w @cadence/web

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist/web/browser /usr/share/nginx/html
EXPOSE 80
