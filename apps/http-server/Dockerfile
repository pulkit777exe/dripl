FROM node:20-alpine

WORKDIR /app

RUN corepack enable pnpm

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod=false

COPY apps/http-server ./apps/http-server
COPY packages/common ./packages/common
COPY packages/db ./packages/db
COPY packages/utils ./packages/utils
COPY tooling/typescript-config ./tooling/typescript-config

WORKDIR /app/apps/http-server
EXPOSE 3002

CMD ["pnpm", "start"]
