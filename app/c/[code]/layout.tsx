import type { Metadata, Viewport } from "next";

export const viewport: Viewport = {
  themeColor: "#0d9488",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  return {
    title: "Portal Pelanggan",
    description: "Portal pelanggan - Pesan produk, cek riwayat, dan kelola cashback",
    manifest: `/api/pwa/manifest?code=${code}`,
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: "Portal Pelanggan",
    },
    icons: {
      icon: [
        { url: "/api/pwa/icon?size=32", sizes: "32x32", type: "image/png" },
        { url: "/api/pwa/icon?size=192", sizes: "192x192", type: "image/png" },
      ],
      apple: "/api/pwa/icon?size=180",
    },
  };
}

export default function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
