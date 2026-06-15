# syntax=docker/dockerfile:1

# Match the Bun version the project was created with.
FROM oven/bun:1.3.2 AS base
WORKDIR /app

# Install dependencies first to leverage Docker layer caching.
FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Final runtime image.
FROM base AS release
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Run as the non-root user provided by the official image.
USER bun

EXPOSE 3000
CMD ["bun", "src/index.ts"]
