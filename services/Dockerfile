FROM node:22-bookworm-slim AS build

ENV NO_DNA=1
RUN corepack enable && corepack prepare pnpm@10.22.0 --activate
WORKDIR /app/services
COPY services/package.json services/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY services/src ./src
COPY services/tsconfig.json ./tsconfig.json
RUN pnpm run build && pnpm prune --prod

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV NO_DNA=1
WORKDIR /app
COPY --from=build --chown=node:node /app/services/package.json ./services/package.json
COPY --from=build --chown=node:node /app/services/node_modules ./services/node_modules
COPY --from=build --chown=node:node /app/services/dist ./services/dist
COPY --chown=node:node client/src/chain/idl/solana.json ./client/src/chain/idl/solana.json
USER node

CMD ["node", "services/dist/keeperWorker.js"]
