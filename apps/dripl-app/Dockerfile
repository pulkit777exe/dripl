FROM node:20-alpine AS base

FROM base AS builder
WORKDIR /app
COPY pnpm-lock.yaml ./
RUN corepack enable pnpm && pnpm install --frozen-lockfile --prod=false
COPY . .
RUN pnpm build

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN corepack enable pnpm

COPY --from=builder /app/apps/dripl-app/package.json ./apps/dripl-app/
COPY --from=builder /app/apps/dripl-app/node_modules ./apps/dripl-app/node_modules
COPY --from=builder /app/apps/dripl-app/.next ./apps/dripl-app/.next
COPY --from=builder /app/packages ./packages

WORKDIR /app/apps/dripl-app
EXPOSE 3000

CMD ["pnpm", "start"]
