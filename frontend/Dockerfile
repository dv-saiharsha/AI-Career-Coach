# Multi-stage: only the traced standalone output (see next.config.ts's
# `output: "standalone"`) reaches the final image, not the full node_modules
# install or the build toolchain.

FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# npm ci, not install — the lockfile is exact-pinned for a reason (most
# dependencies here are caret ranges; a silent minor bump on every build
# would be exactly the "worked yesterday" incident a lockfile exists to
# prevent). See the Production Deployment section of README.md.
RUN npm ci

FROM node:24-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* vars are inlined into the client bundle at build time, not
# read at container startup — they have to be real here, as build args, not
# supplied later at `docker run`. next.config.ts's own production-phase
# check refuses to build at all without NEXT_PUBLIC_API_BASE_URL set.
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

RUN npm run build

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Standalone output already contains a minimal server.js plus only the
# node_modules it actually needs — static assets and public/ are copied in
# separately since standalone deliberately excludes them.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
