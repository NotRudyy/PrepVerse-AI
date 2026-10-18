import type { Metadata } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const themeBootstrap = `try{const value=localStorage.getItem("prepverse-theme")||"system";const hour=new Date().getHours();const dark=value==="dark"||(value==="system"&&(hour<5||hour>=17));document.documentElement.dataset.theme=dark?"dark":"light";document.documentElement.style.colorScheme=dark?"dark":"light";}catch{}`;

export const metadata: Metadata = {
  title: "PrepVerse AI — Build understanding that lasts",
  description: "Your personal study space for course materials, focused practice, and clear explanations from Drift AI.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><head><link rel="preconnect" href="https://fonts.googleapis.com"/><link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous"/><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@600;700&display=swap" rel="stylesheet"/><script dangerouslySetInnerHTML={{ __html: themeBootstrap }}/></head><body suppressHydrationWarning><ThemeProvider>{children}</ThemeProvider></body></html>;
}
