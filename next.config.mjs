/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      {
        source: "/transactions",
        destination: "/mlb/transactions",
        permanent: true,
      },
      {
        source: "/fantasy",
        destination: "/mlb/fantasy",
        permanent: true,
      },
      {
        source: "/predictions",
        destination: "/mlb/predictions",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
