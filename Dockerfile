# syntax=docker/dockerfile:1

# Match the Bun version the project was created with.
FROM oven/bun:1.3.2 AS base
WORKDIR /app

# Install dependencies first to leverage Docker layer caching.
FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM deps AS build
COPY . .
RUN bun run build

# Production uses the same prebuilt Node entry point as LILY.
FROM node:22-alpine AS release
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build /app/dist ./dist
COPY package.json ./

# Run as the non-root user provided by the official image.
USER node

EXPOSE 3000
CMD ["node", "dist/server.js"]
