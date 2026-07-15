FROM node:22-bookworm-slim AS build

RUN corepack enable && corepack prepare pnpm@10.22.0 --activate
WORKDIR /app/services
COPY services/package.json services/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
WORKDIR /app
COPY client/src ./client/src
COPY services/src ./services/src
COPY services/package.json ./services/package.json
COPY services/tsconfig.json ./services/tsconfig.json
WORKDIR /app/services
RUN pnpm run build && pnpm prune --prod

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/services/package.json ./services/package.json
COPY --from=build --chown=node:node /app/services/node_modules ./services/node_modules
COPY --from=build --chown=node:node /app/services/dist ./services/dist
USER node

CMD ["node", "services/dist/services/src/keeperWorker.js"]
