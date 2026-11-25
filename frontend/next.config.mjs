/** @type {import('next').NextConfig} */
const apiOrigin = process.env.API_ORIGIN || "http://127.0.0.1:8000";

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  experimental: {
    // Going back to a page seen in the last 30 seconds is instant instead of waiting on
    // the server again. Every form action clears it (withResult in lib/forms.ts).
    staleTimes: { dynamic: 30 },
  },
  // The API is proxied through the same origin as the web app. Session cookies are
  // SameSite=Strict, so they only travel on same-origin requests; in a deployment the
  // load balancer performs the same routing.
  async rewrites() {
    return [{ source: "/api/:path*", destination: apiOrigin + "/api/:path*" }];
  },
  // Task and notification links are written by the API, which names a few pages
  // differently from the web app.
  async redirects() {
    return [
      { source: "/applications/:id", destination: "/my-applications/:id", permanent: false },
      { source: "/finance/queue", destination: "/finance", permanent: false },
      { source: "/passports/:id([0-9a-f-]{36})", destination: "/evidence/:id", permanent: false },
      { source: "/passports", destination: "/evidence", permanent: false },
      { source: "/passports/shared", destination: "/evidence", permanent: false },
      { source: "/challenges/:id/pilot", destination: "/challenges/:id", permanent: false },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
