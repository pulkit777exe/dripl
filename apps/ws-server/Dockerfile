FROM node:20-alpine

WORKDIR /app

RUN corepack enable pnpm

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY apps/ws-server ./apps/ws-server
COPY packages/common ./packages/common
COPY packages/db ./packages/db
COPY tooling/typescript-config ./tooling/typescript-config

WORKDIR /app/apps/ws-server
EXPOSE 3001

CMD ["pnpm", "start"]
