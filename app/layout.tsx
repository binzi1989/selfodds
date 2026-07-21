import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://selfodds-preflight.xiaozongzi1989.chatgpt.site"),
  title: "SelfOdds — Agent 执行前风控",
  description:
    "在 AI Agent 花钱、修改代码或接触生产系统之前，预测它能否成功。",
  openGraph: {
    title: "SelfOdds — 让 Agent 先知道自己会不会失败",
    description: "执行前成功率预测、风险路由与事后校准账本。",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "SelfOdds Agent 执行前风控" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "SelfOdds — Agent 执行前风控",
    description: "能力不等于可靠性。让每次预测都接受真实结果检验。",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
