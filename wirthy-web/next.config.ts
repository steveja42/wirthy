import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  // The export emits one shell per share route (/c.html, /p.html), which Netlify serves for
  // every /c/* and /p/* id; dev rewrites to the same shells. Dev-only: rewrites are
  // unsupported under export.
  ...(process.env.NODE_ENV === 'development' && {
    async rewrites() {
      return [
        { source: '/c/:id', destination: '/c' },
        { source: '/p/:npub', destination: '/p' },
      ];
    },
  }),
};

export default nextConfig;
