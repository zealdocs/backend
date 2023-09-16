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
                    source: "/v1/:file(releases|docsets)",
                    destination: "/_api/v1/:file.json",
                    has: [
                        {
                            type: "host",
                            value: "api.zealdocs.org",
                        },
                    ],
                },
                // go.zealdocs.org
                {
                    source: "/l/:path*",
                    destination: "/api/go/l/:path*",
                    has: [
                        {
                            type: "host",
                            value: "go.zealdocs.org",
                        },
                    ],
                },
                {
                    source: "/d/:path*",
                    destination: "/api/go/d/:path*",
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
