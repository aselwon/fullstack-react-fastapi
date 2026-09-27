import type { NextConfig } from "next";
const config: NextConfig = { poweredByHeader: false };
export default config;

import('@opennextjs/cloudflare').then(m => m.initOpenNextCloudflareForDev());
