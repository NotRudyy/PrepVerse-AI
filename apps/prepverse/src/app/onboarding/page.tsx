"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, BookOpen } from "lucide-react";
import { apiRequest } from "@/lib/api";

export default function OnboardingPage() {
  const router = useRouter();
  const [college, setCollege] = useState("");
  const [course, setCourse] = useState("");
  const [semester, setSemester] = useState("");
  const [domain, setDomain] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      await apiRequest("/onboarding", { method: "POST", body: JSON.stringify({ college, course, semester: Number(semester), domain }) });
      const next = new URLSearchParams(window.location.search).get("next");
      const safeNext = next?.startsWith("/") && !next.startsWith("//") ? next : null;
      router.replace(safeNext || "/dashboard");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your study profile could not be saved.");
    } finally { setSaving(false); }
  }

  return <main className="site-frame grid min-h-[calc(100vh-60px)] place-items-center p-5 sm:p-9">
    <section className="w-full max-w-[780px] overflow-hidden rounded-[24px] border-2 border-black bg-[#fffef8] shadow-[8px_8px_0_#10100f]">
      <header className="flex items-center justify-between border-b border-black/20 p-5 sm:px-8"><Link href="/" className="flex items-center gap-2 text-[15px] font-black tracking-[-.06em]">PrepVerse <span className="rounded bg-[#efff4f] px-1.5 py-0.5 text-[10px] tracking-normal">AI</span></Link><div className="text-[9px] font-bold uppercase tracking-[.14em] text-[#727168]">Set up your study profile</div></header>
      <form onSubmit={submit} className="p-5 sm:p-8">
        <div className="mb-6 flex size-11 items-center justify-center rounded-xl border border-black bg-[#efff4f]"><BookOpen size={20}/></div>
        <h1 className="display-type text-4xl leading-none sm:text-5xl">Start with your semester.</h1>
        <p className="mt-3 max-w-[580px] text-[12px] leading-5 text-[#69685f]">This information helps personalize your study space. You can add subjects and topics later in StudyPacks.</p>
        <div className="mt-7 grid gap-4 sm:grid-cols-2">
          <label className="text-[10px] font-semibold">College or university<input value={college} onChange={(e)=>setCollege(e.target.value)} required maxLength={140} placeholder="Your college" className="focus-ring mt-1.5 h-11 w-full rounded-xl border border-black/25 bg-transparent px-3 text-[12px] font-normal outline-none placeholder:text-[#99988f]"/></label>
          <label className="text-[10px] font-semibold">Course or program<input value={course} onChange={(e)=>setCourse(e.target.value)} required maxLength={140} placeholder="For example, B.Tech Computer Science" className="focus-ring mt-1.5 h-11 w-full rounded-xl border border-black/25 bg-transparent px-3 text-[12px] font-normal outline-none placeholder:text-[#99988f]"/></label>
          <label className="text-[10px] font-semibold">Semester<input type="number" min={1} max={20} value={semester} onChange={(e)=>setSemester(e.target.value)} required placeholder="Choose your semester" className="focus-ring mt-1.5 h-11 w-full rounded-xl border border-black/25 bg-transparent px-3 text-[12px] font-normal outline-none placeholder:text-[#99988f]"/></label>
          <label className="text-[10px] font-semibold">Study domain<input value={domain} onChange={(e)=>setDomain(e.target.value)} required maxLength={100} placeholder="For example, engineering or commerce" className="focus-ring mt-1.5 h-11 w-full rounded-xl border border-black/25 bg-transparent px-3 text-[12px] font-normal outline-none placeholder:text-[#99988f]"/></label>
        </div>
        {error && <div role="alert" className="mt-5 rounded-xl border border-[#a24127]/35 bg-[#a24127]/5 px-3.5 py-3 text-[11px] text-[#842d18]">{error}</div>}
        <div className="mt-8 flex flex-col-reverse justify-between gap-3 border-t border-black/15 pt-5 sm:flex-row sm:items-center"><Link href="/login" className="inline-flex items-center gap-2 text-[10px] font-semibold text-[#69685f]"><ArrowLeft size={13}/> Sign out</Link><button disabled={saving} type="submit" className="black-button focus-ring inline-flex h-11 items-center justify-center gap-2 rounded-xl px-5 text-[11px] font-bold disabled:cursor-not-allowed disabled:opacity-50">{saving?"Saving profile…":"Continue to your dashboard"}<ArrowRight size={14}/></button></div>
      </form>
    </section>
  </main>;
}
