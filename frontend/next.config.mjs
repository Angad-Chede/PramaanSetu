/** @type {import('next').NextConfig} */
const apiOrigin = process.env.API_ORIGIN || "http://127.0.0.1:8000";

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  // The API is proxied through the same origin as the web app. Session cookies are
  // SameSite=Strict, so they only travel on same-origin requests; in a deployment the
  // load balancer performs the same routing.
  async rewrites() {
    return [{ source: "/api/:path*", destination: apiOrigin + "/api/:path*" }];
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
