import type { Metadata, Viewport } from "next";
import "vazirmatn/Vazirmatn-font-face.css";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "هوش‌یار — ایستگاه کاری هوش مصنوعی شخصی",
  description:
    "دستیار هوش مصنوعی شخصی با معماری BYOK: کلیدهای خودتان را وارد کنید و بلافاصله گفتگو، عامل هوشمند، اجرای کد، جستجوی وب و بازیابی اسناد را داشته باشید.",
  keywords: ["هوش مصنوعی", "دستیار شخصی", "BYOK", "عامل هوشمند", "چت", "فارسی", "RTL"],
  applicationName: "هوش‌یار",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf9" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0a09" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground font-sans">
        {children}
        <Toaster position="bottom-center" dir="rtl" richColors closeButton />
      </body>
    </html>
  );
}
