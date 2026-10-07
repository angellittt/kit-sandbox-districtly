# Keep in sync with mise.toml (checked by `pnpm check:tool-versions`).
ARG NODE_VERSION=24.14.0
FROM node:${NODE_VERSION}-alpine AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME/bin:$PNPM_HOME:$PATH"
RUN apk add --no-cache ca-certificates openssl
RUN corepack enable
# Keep in sync with mise.toml.
ARG PNPM_VERSION=10.30.3
RUN corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

FROM base AS prepare


RUN pnpm add turbo --global
COPY . .
RUN turbo prune api --docker

FROM base AS builder

COPY --from=prepare /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=prepare /app/out/full/ .

# Uncomment and use build args to enable remote caching
# ARG TURBO_TEAM
# ENV TURBO_TEAM=$TURBO_TEAM

# ARG TURBO_TOKEN
# ENV TURBO_TOKEN=$TURBO_TOKEN

RUN pnpm turbo build

# Development target
FROM builder AS development

CMD ["pnpm", "--filter", "api", "dev"]

# Production target
FROM node:${NODE_VERSION}-alpine AS production
WORKDIR /app

RUN apk add --no-cache ca-certificates openssl

RUN addgroup -S -g 1001 expressjs
RUN adduser -S -u 1001 -G expressjs expressjs
USER expressjs

COPY --from=builder /app .
CMD ["node", "apps/api/dist/index.js"]