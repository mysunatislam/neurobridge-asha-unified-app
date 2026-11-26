/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(self), geolocation=(self)",
  },
];

const nextConfig = {
  reactStrictMode: true,
  // Development only: hosts of a tunnel to this dev server (see
  // docs/DEPLOYMENT_NOTES.md, "Sharing a local build through a tunnel").
  allowedDevOrigins: (process.env.ASHA_DEV_ORIGINS || "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean),
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      {
        source: "/api/(.*)",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
  async redirects() {
    return [
      // Existing module and private role links open the complete assistive app.
      // Query values pass through; private access codes remain in the browser hash.
      {
        source: "/",
        has: [
          {
            type: "query",
            key: "module",
            value:
              "(?<module>facespeak|fingerspeak|senseassist|vitalsense|posture)",
          },
        ],
        destination: "/assistive.html?module=:module",
        permanent: false,
      },
      {
        source: "/",
        has: [
          { type: "query", key: "role", value: "(?<role>patient|caregiver)" },
        ],
        destination: "/assistive.html?role=:role",
        permanent: false,
      },
      ...[
        "/app",
        "/app.html",
        "/index.html",
        "/asha.html",
        "/modules",
        "/modules/index.html",
      ].map((source) => ({
        source,
        destination: "/assistive.html",
        permanent: false,
      })),
      ...[
        "/care",
        "/caregiver",
        "/caregiver/index.html",
        "/pair",
        "/pair/index.html",
      ].map((source) => ({
        source,
        destination: "/assistive.html?role=caregiver",
        permanent: false,
      })),
      ...["/patient", "/patient/index.html"].map((source) => ({
        source,
        destination: "/assistive.html?role=patient",
        permanent: false,
      })),
      ...["/neuroface", "/neuroface/index.html"].map((source) => ({
        source,
        destination: "/assistive.html?module=facespeak",
        permanent: false,
      })),
      ...["/senseassist", "/senseassist/index.html"].map((source) => ({
        source,
        destination: "/assistive.html?module=senseassist",
        permanent: false,
      })),
      ...[
        "/vitalsense",
        "/vitalsense/index.html",
        "/vitals-preview",
        "/vitals-preview/index.html",
      ].map((source) => ({
        source,
        destination: "/assistive.html?module=vitalsense",
        permanent: false,
      })),
      { source: "/everyday", destination: "/everyday.html", permanent: false },
      ...["/website", "/website/index.html"].map((source) => ({
        source,
        destination: "https://asha-neurobridge-website.vercel.app/",
        permanent: false,
      })),
    ];
  },
};

export default nextConfig;
