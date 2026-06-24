/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      {
        source: "/transactions",
        destination: "/mlb/transactions",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
