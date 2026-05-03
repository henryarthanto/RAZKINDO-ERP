import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";
import { ErrorBoundary } from "@/components/error-boundary";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const isSTB = process.env.STB_MODE === 'true' || process.env.STB_MODE === '1';

export const viewport: Viewport = {
  themeColor: isSTB ? "#0f172a" : "#0f172a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  // STB: ensure fullscreen display without browser chrome
  ...(isSTB ? { interactiveWidget: "resizes-content" as const } : {}),
};

export const metadata: Metadata = {
  title: "Razkindo ERP - Enterprise Resource Planning",
  description: "Sistem ERP komprehensif untuk manajemen bisnis multi-unit dengan fitur lengkap: transaksi, inventori, keuangan, dan analitik.",
  keywords: ["ERP", "Razkindo", "Business Management", "Inventory", "Finance", "Sales"],
  authors: [{ name: "Razkindo Team" }],
  icons: {
    icon: [
      { url: "/api/pwa/icon?size=32", sizes: "32x32", type: "image/png" },
      { url: "/api/pwa/icon?size=192", sizes: "192x192", type: "image/png" },
      ...(isSTB ? [{ url: "/api/pwa/icon?size=512", sizes: "512x512", type: "image/png" }] : []),
    ],
    apple: "/api/pwa/icon?size=180",
  },
  manifest: "/api/pwa/manifest",
  // STB: force standalone display when installed as PWA
  ...(isSTB ? {
    other: {
      "mobile-web-app-capable": "yes",
    },
  } : {}),
  openGraph: {
    title: "Razkindo ERP",
    description: "Enterprise Resource Planning System",
    type: "website",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Razkindo ERP",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" suppressHydrationWarning>
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="application-name" content="Razkindo ERP" />
        <meta name="apple-mobile-web-app-title" content="Razkindo ERP" />
        <link rel="apple-touch-icon" href="/api/pwa/icon?size=180" />
        <link rel="apple-touch-icon" sizes="152x152" href="/api/pwa/icon?size=152" />
        <link rel="apple-touch-icon" sizes="120x120" href="/api/pwa/icon?size=120" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {/* STB mode flag for client-side detection */}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__STB_MODE__ = ${isSTB};`,
          }}
        />
        <ErrorBoundary>
          {children}
        </ErrorBoundary>
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
