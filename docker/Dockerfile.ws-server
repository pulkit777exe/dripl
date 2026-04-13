FROM node:20-alpine AS deps
WORKDIR /app

RUN corepack enable pnpm

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/common/package.json      ./packages/common/
COPY packages/db/package.json          ./packages/db/
COPY packages/math/package.json        ./packages/math/
COPY packages/element/package.json     ./packages/element/
COPY packages/runtime/package.json     ./packages/runtime/
COPY packages/utils/package.json       ./packages/utils/
COPY packages/dripl/package.json       ./packages/dripl/
COPY apps/ws-server/package.json       ./apps/ws-server/
COPY tooling/typescript-config/package.json ./tooling/typescript-config/

ENV PRISMA_SKIP_POSTINSTALL_GENERATE=true
RUN pnpm install --frozen-lockfile --network-concurrency 8 --fetch-retries 5

COPY packages/ ./packages/
COPY tooling/  ./tooling/
RUN cd packages/db && npx prisma generate --no-engine --schema=./prisma/schema.prisma
RUN pnpm --filter "@dripl/common" build && \
    pnpm --filter "@dripl/db" build && \
    pnpm --filter "@dripl/math" build && \
    pnpm --filter "@dripl/utils" build && \
    pnpm --filter "@dripl/element" build && \
    pnpm --filter "@dripl/runtime" build && \
    pnpm --filter "@dripl/dripl" build

COPY apps/ws-server/ ./apps/ws-server/

FROM node:20-alpine AS runner
WORKDIR /app

RUN npm install -g pnpm@10.33.0

COPY --from=deps /app/node_modules        ./node_modules
COPY --from=deps /app/packages            ./packages
COPY --from=deps /app/tooling             ./tooling
COPY --from=deps /app/apps/ws-server      ./apps/ws-server
COPY --from=deps /app/package.json        ./package.json
COPY --from=deps /app/pnpm-workspace.yaml ./pnpm-workspace.yaml

WORKDIR /app/apps/ws-server
EXPOSE 3001
CMD pnpm run dev
