/** @type {import("next").NextConfig} */
const nextConfig = {
    async redirects() {
        return [
            {
                source: "/",
                destination: "https://zealdocs.org",
                permanent: false,
            },
        ];
    },

    async rewrites() {
        return {
            beforeFiles: [
                // api.zealdocs.org
                {
                    source: "/v1/docsets",
                    destination: "/docsets.json",
                },
                {
                    source: "/v1/releases",
                    destination: "/releases.json",
                },
                // go.zealdocs.org
                {
                    source: "/:path*",
                    destination: "/api/go/:path*",
                    has: [
                        {
                            type: "host",
                            value: "go.zealdocs.org",
                        },
                    ],
                },
            ],
        };
    },
};

export default nextConfig;
