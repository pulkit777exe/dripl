FROM node:20-alpine AS base

FROM base AS builder
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

COPY apps/dripl-app/package.json ./apps/dripl-app/
COPY packages/common/package.json ./packages/common/
COPY packages/db/package.json ./packages/db/
COPY tooling/typescript-config/package.json ./tooling/typescript-config/

RUN corepack enable pnpm && pnpm install --frozen-lockfile --prod=false

COPY . .
RUN pnpm build

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/dripl-app/.next ./apps/dripl-app/.next
COPY --from=builder /app/packages ./packages

WORKDIR /app/apps/dripl-app
EXPOSE 3000

CMD ["node", "node_modules/next/dist/bin/next", "start"]