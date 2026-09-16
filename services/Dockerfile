FROM node:24-bookworm-slim AS build

ENV NO_DNA=1
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/package.json ./services/package.json
COPY tools/chain/package.json ./tools/chain/package.json
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY services/src ./services/src
COPY services/release-deploy.ts ./services/release-deploy.ts
COPY services/tests ./services/tests
COPY services/zkube-core ./services/zkube-core
COPY tools/chain ./tools/chain
COPY shared ./shared
COPY tools/build-node.mjs ./tools/build-node.mjs
RUN pnpm run build && pnpm prune --prod

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV NO_DNA=1
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist/services/src ./dist/services/src
COPY --from=build --chown=node:node /app/dist/services/zkube-core ./dist/services/zkube-core
COPY --from=build --chown=node:node /app/dist/shared ./dist/shared
COPY --from=build --chown=node:node /app/dist/tools/chain/idl ./dist/tools/chain/idl
USER node

CMD ["node", "dist/services/src/keeperWorker.js"]
