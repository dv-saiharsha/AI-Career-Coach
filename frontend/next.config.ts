import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  compiler: {
    styledComponents: true,
  },
  // Pins the bundler's workspace root to this folder so a stray lockfile
  // elsewhere on disk can never cause it to mis-resolve the project root.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
