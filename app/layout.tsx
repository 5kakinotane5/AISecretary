import type { Metadata } from "next";
import { Inter, Noto_Sans_JP } from "next/font/google";
import "./globals.css";

// design-spec.md 3章：本文（英数字）Inter、本文（日本語）Noto Sans JP。
// どちらも variable フォントなので weight は指定しない
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const notoSansJP = Noto_Sans_JP({
  variable: "--font-noto-sans-jp",
  subsets: ["latin"],
});

// design-spec.md 9.5：アプリ名「PURCHART」の適用範囲
export const metadata: Metadata = {
  title: "PURCHART",
  description: "まだ決まっていない未来を、今の自分から航海する。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className={`${inter.variable} ${notoSansJP.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
