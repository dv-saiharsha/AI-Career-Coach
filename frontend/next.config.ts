import path from "node:path";
import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";

const nextConfig: NextConfig = {
  // Traces only the node_modules a production boot actually needs into
  // .next/standalone, instead of shipping the whole install — this is what
  // makes the Docker image reasonably sized rather than carrying every dev
  // dependency into the runtime layer.
  output: "standalone",
  compiler: {
    styledComponents: true,
  },
  // Pins the bundler's workspace root to this folder so a stray lockfile
  // elsewhere on disk can never cause it to mis-resolve the project root.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

// NEXT_PUBLIC_* vars are inlined into the client bundle at build time, not
// read at container startup — a production build run without one has
// shipped real users pointed at http://localhost:8000/api before, silently.
// Checked only for the production build phase, by the phase Next itself
// reports: `next dev` keeps the runtime fallback in lib/apiClient.ts for
// local convenience, since a missing var there just fails one local
// request, not a whole deployed client.
export default function config(phase: string): NextConfig {
  if (phase === PHASE_PRODUCTION_BUILD && !process.env.NEXT_PUBLIC_API_BASE_URL?.trim()) {
    throw new Error(
      "Build aborted — NEXT_PUBLIC_API_BASE_URL is not set.\n" +
        "This is baked into the client bundle at build time, not read at container " +
        "startup, so building without it ships every user pointed at a placeholder " +
        "that only works on the machine that built it.\n" +
        "Set it before building — see frontend/.env.local.example.",
    );
  }
  return nextConfig;
}
