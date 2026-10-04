import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  // 기본 설정은 `/api/*` GET 응답과 다른 출처 응답을 서비스 워커 캐시에 (평문으로)
  // 저장한다. 노트 본문·첨부가 기기에 남게 되므로 둘 다 네트워크 전용으로 덮어쓴다.
  // 기기에 남기는 것은 암호화 보관소(src/lib/offlineStore.ts)만 담당한다.
  extendDefaultRuntimeCaching: true,
  workboxOptions: {
    runtimeCaching: [
      {
        urlPattern: ({ sameOrigin, url }) => sameOrigin && url.pathname.startsWith("/api/"),
        handler: "NetworkOnly",
        options: { cacheName: "apis" },
      },
      {
        urlPattern: ({ sameOrigin }) => !sameOrigin,
        handler: "NetworkOnly",
        options: { cacheName: "cross-origin" },
      },
    ],
  },
});

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  async redirects() {
    return [];
  },
};

export default withPWA(nextConfig);
