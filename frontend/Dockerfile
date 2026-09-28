# Multi-stage: the build toolchain (vite, typescript, tailwind) only runs in
# the `builder` stage; the final image just serves the built dist/ output.

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

# VITE_* vars are inlined into the client bundle at build time, not read at
# container startup — they have to be real here, as build args, not supplied
# later at `docker run`. See README.md's Production Deployment section.
ARG VITE_API_BASE_URL
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY

RUN npm run build

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# node_modules here still includes devDependencies (vite itself, needed
# below) — `npm ci` was never run with --omit=dev. Only dist/ is the actual
# app; everything else is the static-file server.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

# `vite preview` serves the built dist/ output with SPA fallback (unknown
# paths resolve to index.html, required for react-router's client-side
# routes). It is a preview server, not a hardened production web server —
# no compression tuning, limited concurrency. Fine for now since this repo
# has no configured deploy target yet (see README.md); swap in nginx or
# another static server before real production traffic depends on this image.
EXPOSE 3000
CMD ["npx", "vite", "preview", "--host", "--port", "3000"]
