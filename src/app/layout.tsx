import type { Metadata } from "next";
import { Outfit, Zen_Dots } from "next/font/google";
import "./globals.css";
import Providers from "@/providers";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

const pixelFont = Zen_Dots({
  weight: "400",
  variable: "--font-pixel",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CampusByte - Smart Student Dining and Counter Pre-Ordering",
  description: "Browse live canteen counters, monitor queue traffic load, pre-order meals, and get instant pickup slips at your college campus.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="scroll-smooth">
      <body className={`${outfit.variable} ${pixelFont.variable} antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
