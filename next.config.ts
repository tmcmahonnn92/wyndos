import type { NextConfig } from "next";
import path from "path";
import fs from "fs";

function releaseId(): string | undefined {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(__dirname, ".release-meta.json"), "utf8"));
    const id = `${String(meta.commit ?? "").slice(0, 12)}-${String(meta.builtAt ?? "").replace(/\D/g, "")}`;
    return id.length > 1 ? id : undefined;
  } catch {
    return undefined;
  }
}

// Offline support is our own service worker in public/sw.js (registered by OfflineStatus).
const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  poweredByHeader: false,
  // From the release the deploy script made (same at build and start). When a page from an
  // older build navigates after an update, Next does a full page load instead of mixing files.
  deploymentId: releaseId(),
  async headers() {
    return [
      {
        // Basic protection on every page: no framing by other sites, no MIME guessing,
        // HTTPS only, and nothing leaked in the Referer header.
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self), payment=()" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        // Bank statement matching: never kept by the browser or any cache.
        source: "/payments/import",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
    ];
  },
};

export default nextConfig;
