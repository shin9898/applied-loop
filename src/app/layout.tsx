import type { Metadata } from "next";
import { DotGothic16, Noto_Sans_JP, Press_Start_2P, Shippori_Mincho } from "next/font/google";
import "./globals.css";
import "./atlas-living.css";

const pressStart = Press_Start_2P({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-press-start",
  display: "swap",
});
const dotGothic = DotGothic16({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-dotgothic",
  display: "swap",
});

const notoSans = Noto_Sans_JP({
  variable: "--font-noto",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

const shippori = Shippori_Mincho({
  variable: "--font-shippori",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "ぼうけんのしょ — Applied Loop",
  description: "学びを実務適用の証跡に変えるループ",
  applicationName: "Applied Loop",
  // favicon / apple-touch は app/icon.svg と app/apple-icon.tsx（file convention）
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${notoSans.variable} ${pressStart.variable} ${dotGothic.variable} ${shippori.variable} h-full antialiased`}
    >
      <body className="atlas-dq flex min-h-full flex-col">{children}</body>
    </html>
  );
}
