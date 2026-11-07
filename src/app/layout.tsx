import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "취향 밸런스 게임",
  description: "서로 얼마나 잘 알고 있나요? 두 사람이 함께 즐기는 취향 밸런스 게임",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased min-h-screen bg-[#FFF0F5] text-gray-900">
        {children}
      </body>
    </html>
  );
}
