import path from "node:path";
import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";

const nextConfig: NextConfig = {
  // Traces only the node_modules a production boot actually needs into
  // .next/standalone, instead of shipping the whole install — this is what
  // makes the Docker image reasonably sized rather than carrying every dev
  // dependency into the runtime layer.
  output: "standalone",

  // No dev overlay badge. It floats over the bottom-left of every page in
  // development, which is exactly where this app puts the account card — so
  // it sat on top of real UI and showed up in screenshots of the product.
  // Purely a development affordance; nothing in production renders it.
  devIndicators: false,

  /* /features and /how-it-works answered halves of the same question, so
     people had to read both and join them up. They are one page now.
     Permanent rather than temporary: the old URL is not coming back, and a
     307 would leave search engines indexing a route that no longer exists. */
  async redirects() {
    return [{ source: "/features", destination: "/how-it-works", permanent: true }];
  },

  /* Response headers. Next serves the HTML, so this is where they belong —
     the FastAPI side returns JSON to fetch() and gets nothing from them.

     Permissions-Policy is the one that needed checking rather than copying.
     The interview composer calls getUserMedia({ audio: true }), so a blanket
     microphone=() — which is what most boilerplate ships — would silently
     break voice answers with a permissions error and no obvious cause.
     Camera and geolocation are denied outright because nothing asks for them.

     There is deliberately no full Content-Security-Policy here. Next injects
     inline bootstrap scripts, so a real CSP needs per-request nonces through
     middleware, and a script-src that is wrong in a way this environment
     cannot see would take the app down in production rather than degrade it.
     frame-ancestors is the one directive that carries no such risk and is
     the modern half of X-Frame-Options, so it ships now; the rest wants a
     browser to verify against. */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // The app is never framed, and clickjacking a resume upload or an
          // account-deletion confirmation is the reason to say so twice:
          // X-Frame-Options for older browsers, frame-ancestors for current.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Full URLs leak analysis ids and job ids into third-party
          // referers; the origin alone is all any of them need.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
          // Sent unconditionally: browsers ignore HSTS over plain HTTP, so
          // this is inert in local development rather than something that
          // needs a production-only branch to stay safe.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },

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
