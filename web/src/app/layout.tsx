import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "./providers";

const inter = Inter({ subsets: ["latin"], variable: "--font-ui", display: "swap" });
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Cloud Memo",
  description: "개인 클라우드 메모 플랫폼 MVP",
  manifest: "/manifest.json",
  applicationName: "Cloud Memo",
  appleWebApp: {
    capable: true,
    title: "Cloud Memo",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#101727",
  width: "device-width",
  initialScale: 1,
  // 핀치 줌은 접근성을 위해 허용 (maximumScale 제거)
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className={`${inter.variable} ${jetbrains.variable} min-h-dvh bg-paper`}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
