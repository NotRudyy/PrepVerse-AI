"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BookOpen, Brain, CalendarDays, ChartNoAxesColumnIncreasing, CircleHelp, DoorOpen, House, Mic2, NotebookPen, Settings, Sparkles, Target, UsersRound } from "lucide-react";
import { apiRequest } from "@/lib/api";

const links = [
  { href: "/dashboard", label: "Dashboard", icon: House },
  { href: "/study-packs", label: "StudyPacks", icon: BookOpen },
  { href: "/drift", label: "Drift AI", icon: Sparkles },
  { href: "/practice", label: "Practice", icon: Target },
  { href: "/mistakes", label: "Mistake Lab", icon: Brain },
  { href: "/skill-tree", label: "Skill Tree", icon: ChartNoAxesColumnIncreasing },
  { href: "/planner", label: "Study Planner", icon: CalendarDays },
  { href: "/focus", label: "Focus Room", icon: CircleHelp },
  { href: "/voice-notes", label: "Voice Notes", icon: Mic2 },
  { href: "/rooms", label: "Study Rooms", icon: UsersRound },
  { href: "/wrapped", label: "Study Wrapped", icon: NotebookPen },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppSidebar({ active }: { active: string }) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  async function signOut() {
    setSigningOut(true);
    try { await apiRequest("/auth/logout", { method: "POST" }); }
    finally { router.replace("/login"); }
  }
  return <aside className="app-sidebar flex w-full shrink-0 flex-col border-b border-black/20 bg-[#e9e6d8] p-4 lg:sticky lg:top-0 lg:h-screen lg:w-[82px] lg:border-b-0 lg:border-r lg:p-3">
    <Link href="/dashboard" aria-label="PrepVerse AI dashboard" className="sidebar-brand mb-4 flex items-center justify-center gap-2 px-2 py-2 text-[18px] font-black tracking-[-.06em]">
      <span className="sidebar-brand-text">PrepVerse <span className="rounded px-1.5 py-0.5 text-[11px] tracking-normal" style={{ background: "var(--acid)" }}>AI</span></span>
      <span className="sidebar-brand-mark" aria-hidden="true">P</span>
    </Link>
    <div className="sidebar-workspace-label mb-2 hidden px-3 text-[9px] font-bold uppercase tracking-[.16em] text-[#74736a] lg:block">Your workspace</div>
    <nav aria-label="Study workspace" className="app-sidebar-nav scrollbar-hide flex gap-1 overflow-x-auto lg:flex-1 lg:flex-col lg:items-center lg:overflow-visible">
      {links.map(({ href, label, icon: Icon }) => {
        const isActive = active === href;
        return <Link key={href} href={href} title={label} aria-label={label} aria-current={isActive ? "page" : undefined} className={`sidebar-link focus-ring relative flex min-w-fit items-center gap-3 rounded-xl px-3 py-2.5 text-[11px] font-semibold transition lg:w-12 lg:justify-center lg:px-0 ${isActive ? "border border-black bg-[#efff4f] shadow-[2px_2px_0_#10100f]" : "text-[#626159] hover:bg-black/5 hover:text-black"}`}><Icon size={16} strokeWidth={1.8}/><span className="sidebar-link-label">{label}</span></Link>;
      })}
    </nav>
    <div className="sidebar-help-card mt-4 hidden rounded-2xl border border-black/20 bg-[#fffef8] p-3 lg:block">
      <div className="text-[10px] font-bold">Need a hand?</div><p className="mt-1 text-[9px] leading-4 text-[#6e6d64]">Open Drift AI to ask about the material you&apos;re studying.</p>
      <Link href="/drift" className="mt-2 inline-flex items-center gap-1 text-[9px] font-bold underline decoration-black/35 underline-offset-2">Ask Drift AI <Sparkles size={11}/></Link>
    </div>
    <div className="sidebar-signout mt-3 hidden border-t border-black/15 pt-3 lg:block"><button type="button" aria-label={signingOut ? "Signing out" : "Sign out"} title={signingOut ? "Signing out" : "Sign out"} onClick={()=>void signOut()} disabled={signingOut} className="sidebar-signout-button flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[10px] font-semibold text-[#626159] hover:bg-black/5 disabled:opacity-50"><DoorOpen size={15}/><span className="sidebar-signout-label">{signingOut?"Signing out…":"Sign out"}</span></button></div>
  </aside>;
}
