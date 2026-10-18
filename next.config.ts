import type { NextConfig } from "next";

const isDevelopment = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  devIndicators: {
    position: "top-right",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Allow same-origin embedding only. Use CSP frame-ancestors if
          // specific external embed origins need to be allowed in future.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          // Content-Security-Policy: defense-in-depth for model-generated
          // output. Kept Next-compatible: Next.js needs 'unsafe-inline'
          // for scripts/styles (and 'unsafe-eval' in dev). The binding parts
          // are object-src, base-uri, frame-ancestors, and a connect-src
          // that only allows the app itself plus Supabase (realtime uses
          // wss). Fonts are self-hosted via next/font; images are same-origin
          // or client data/blob URLs. If a new third-party embed is ever
          // added, its origin must be allow-listed here first.
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
              "frame-ancestors 'self'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              ...(isDevelopment ? [] : ["upgrade-insecure-requests"]),
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
