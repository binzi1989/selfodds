import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SelfOdds — Agent Preflight",
  description:
    "Predict whether an AI agent will succeed before it spends money or touches production.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
