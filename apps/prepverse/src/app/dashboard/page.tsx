"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, ArrowRight, BookOpen, CalendarClock, Check, Clock3, Flame, Sparkles, Target, Trophy } from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { ApiError, apiConfigured, apiRequest, DashboardData } from "@/lib/api";

function minutesLabel(minutes: number) {
  const safeMinutes = Math.max(0, Math.floor(minutes));
  return safeMinutes >= 60 ? `${Math.floor(safeMinutes / 60)}h ${safeMinutes % 60}m` : `${safeMinutes}m`;
}

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!apiConfigured) {
      setMessage("PrepVerse's secure service is not configured yet. Connect the service to load your personal study data.");
      setLoading(false);
      return;
    }
    apiRequest<DashboardData>("/dashboard")
      .then(setData)
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) { router.replace("/login"); return; }
        setMessage(error instanceof Error ? error.message : "Your dashboard could not be loaded.");
      })
      .finally(() => setLoading(false));
  }, [router]);

  return <div className="site-frame app-frame min-h-[calc(100vh-60px)]">
    <div className="lg:flex">
      <AppSidebar active="/dashboard" />
      <main className="min-w-0 flex-1 bg-[#f6f4eb] px-4 py-5 sm:px-7 sm:py-7 lg:px-9">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div><div className="text-[9px] font-bold uppercase tracking-[.16em] text-[#777823]">YOUR STUDY OVERVIEW</div><h1 className={`display-type mt-1 text-4xl leading-none sm:text-5xl ${data ? "welcome-heading" : ""}`}>{data ? `Welcome back, ${data.profile.display_name}.` : "Your study dashboard."}</h1><p className="mt-2 text-[11px] text-[#66655d]">Your materials and activity will shape what you see here.</p></div>
          <Link href="/study-packs" className="acid-button focus-ring inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[10px] font-bold"><BookOpen size={14}/> Add study material <ArrowRight size={13}/></Link>
        </header>

        {loading ? <div role="status" className="rounded-2xl border border-black/20 bg-white/60 p-6 text-[12px] text-[#68675f]">Loading your study data…</div> : message ? <section role="alert" className="rounded-2xl border-2 border-black bg-[#fffef8] p-5 shadow-[3px_3px_0_#10100f] sm:p-7"><div className="flex items-start gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#efff4f]"><Activity size={17}/></span><div><h2 className="text-[13px] font-black">Your account data isn&apos;t connected</h2><p className="mt-1 max-w-[650px] text-[11px] leading-5 text-[#69685f]">{message}</p><Link href="/login" className="mt-4 inline-flex items-center gap-2 rounded-lg bg-black px-3.5 py-2.5 text-[10px] font-bold text-white">Go to sign in <ArrowRight size={13}/></Link></div></div></section> : data && <DashboardContent data={data}/>}
      </main>
    </div>
  </div>;
}

function DashboardContent({ data }: { data: DashboardData }) {
  const metrics = [
    { label: "Study streak", value: `${data.stats.streak_days} days`, icon: Flame },
    { label: "Overall mastery", value: `${data.stats.mastery_percent}%`, icon: Target },
    { label: "XP today", value: `${data.stats.xp_today} XP`, icon: Trophy },
    { label: "Focus time", value: minutesLabel(data.stats.focus_minutes_today), icon: Clock3 },
  ];
  const subjects = data.pinned_subjects ?? [];
  const topics = subjects.flatMap((subject) => subject.popular_topics.map((topic) => ({...topic, subject: subject.name}))).slice(0, 4);
  const rhythm = data.study_rhythm_minutes ?? [];

  return <>
    <section aria-label="Study progress" className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map(({label,value,icon:Icon})=><article key={label} className="rounded-2xl border border-black/20 bg-[#fffef8] p-4"><div className="flex items-center justify-between text-[10px] font-semibold text-[#66655d]"><span>{label}</span><span className="flex size-7 items-center justify-center rounded-lg bg-[#efff4f]"><Icon size={14}/></span></div><div className="mt-4 text-2xl font-black tracking-[-.05em]">{value}</div></article>)}
    </section>

    {subjects.length===0 && <section className="mb-6 rounded-2xl border-2 border-black bg-[#fffefa] p-5 shadow-[3px_3px_0_#10100f] sm:p-7"><div className="flex items-start gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#efff4f]"><BookOpen size={18}/></span><div><h2 className="text-[14px] font-black">Your study space is ready for your materials.</h2><p className="mt-2 max-w-[760px] text-[11px] leading-5 text-[#5e6670]">To get study information based on your semester, upload your course materials or add the subjects and topics you want to study. Drift AI will use that information to organize your dashboard.</p><Link href="/study-packs" className="mt-4 inline-flex items-center gap-2 rounded-lg bg-black px-4 py-2.5 text-[10px] font-bold text-white">Open StudyPacks <ArrowRight size={13}/></Link></div></div></section>}

    <section className="mb-6 grid gap-4 xl:grid-cols-[1.45fr_.9fr]">
      <div className="rounded-2xl border border-black/20 bg-[#fffef8] p-4 sm:p-5"><div className="mb-4 flex items-center justify-between"><div><div className="text-[12px] font-black">Your pinned subjects</div><p className="mt-1 text-[9px] text-[#737168]">Pin the courses you want to keep close.</p></div><Link href="/study-packs" aria-label="Manage subjects" className="focus-ring rounded-lg p-2 hover:bg-black/5"><ArrowRight size={15}/></Link></div>
        {subjects.length===0 ? <div className="rounded-xl border border-dashed border-black/25 px-4 py-7 text-center"><p className="text-[10px] text-[#77766d]">No subjects pinned yet.</p><Link href="/study-packs" className="mt-2 inline-block text-[10px] font-bold underline underline-offset-2">Add a subject</Link></div> : <div className="grid gap-3 sm:grid-cols-2">{subjects.map((subject)=><article key={subject.id} className="rounded-xl border border-black/20 p-4"><div className="flex items-start justify-between gap-2"><h3 className="text-[11px] font-black">{subject.name}</h3><span className="rounded-md bg-[#efff4f] px-2 py-1 text-[9px] font-bold">{subject.mastery_percent}%</span></div><p className="mt-2 text-[9px] text-[#737168]">{subject.completed_topics} of {subject.total_topics} topics completed</p><div className="mt-2 h-2 overflow-hidden rounded-full border border-black/20 bg-[#e8e6d9]"><span className="block h-full rounded-full bg-[#c7d326]" style={{width:`${Math.min(100,Math.max(0,subject.mastery_percent))}%`}}/></div></article>)}</div>}
      </div>
      <div className="rounded-2xl border border-black/20 bg-[#10100f] p-5 text-[#f2f0e5]"><div className="flex items-center gap-2 text-[12px] font-black"><span className="flex size-7 items-center justify-center rounded-lg bg-[#efff4f] text-black"><Sparkles size={14}/></span>Ask Drift AI</div><p className="mt-3 text-[10px] leading-5 text-white/65">Ask about a concept from your materials or get help deciding what to study next.</p><Link href="/drift" className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#efff4f] px-4 py-2.5 text-[10px] font-black text-black">Open Drift AI <ArrowRight size={13}/></Link></div>
    </section>

    <section className="mb-6 grid gap-4 xl:grid-cols-[1.35fr_.9fr]">
      <div className="rounded-2xl border border-black/20 bg-[#fffef8] p-4 sm:p-5"><div className="mb-4 flex items-center justify-between"><div><h2 className="text-[12px] font-black">Explore popular topics</h2><p className="mt-1 text-[9px] text-[#737168]">Topics identified from your course materials.</p></div><BookOpen size={16}/></div>
        {topics.length===0 ? <div className="rounded-xl border border-dashed border-black/25 px-4 py-6 text-center text-[10px] text-[#77766d]">Upload materials to see topics relevant to your subjects.</div> : <div className="grid gap-2 sm:grid-cols-2">{topics.map((topic)=><article key={topic.id} className="rounded-xl border border-black/20 p-3"><div className="flex items-start justify-between gap-2"><div><div className="text-[10px] font-bold">{topic.title}</div><div className="mt-1 text-[9px] text-[#737168]">{topic.subject}</div></div><span className="rounded-full border border-black/20 px-2 py-1 text-[8px] font-bold capitalize">{topic.importance}</span></div></article>)}</div>}
      </div>
      <div className="rounded-2xl border border-black/20 bg-[#fffef8] p-4 sm:p-5"><div className="mb-3 flex items-center gap-2 text-[12px] font-black"><Activity size={15}/>Your study rhythm</div><p className="mb-5 text-[9px] text-[#737168]">Time spent in focused study this week.</p>{rhythm.some((item)=>item>0) ? <div className="flex h-24 items-end gap-2" aria-label="Study activity this week">{rhythm.map((minutes,index)=><div key={index} className="flex flex-1 flex-col items-center gap-1"><span className="text-[8px] text-[#737168]">{minutesLabel(minutes)}</span><div className="w-full rounded-t-md bg-[#d4df32]" style={{height:`${Math.max(4,Math.min(100,minutes/Math.max(...rhythm)*72))}%`}}/><span className="text-[8px] text-[#737168]">{["M","T","W","T","F","S","S"][index]}</span></div>)}</div> : <div className="rounded-xl border border-dashed border-black/25 px-3 py-6 text-center text-[10px] text-[#77766d]">Your focused study time will appear here as you study.</div>}</div>
    </section>

    <section className="grid gap-4 xl:grid-cols-3">
      <article className="rounded-2xl border border-black/20 bg-[#fffef8] p-4"><div className="mb-3 flex items-center gap-2 text-[11px] font-black"><Activity size={14}/>Jump back in</div>{data.recent_activity.length===0?<p className="text-[10px] leading-5 text-[#77766d]">Your recent study activity will appear here.</p>:<div className="space-y-3">{data.recent_activity.slice(0,3).map((item)=><Link key={item.id} href={item.href} className="block rounded-lg border border-black/10 p-3 hover:bg-black/[.025]"><div className="text-[10px] font-bold">{item.title}</div><div className="mt-1 text-[9px] text-[#737168]">{item.subject}</div></Link>)}</div>}</article>
      <article className="rounded-2xl border border-black/20 bg-[#fffef8] p-4"><div className="mb-3 flex items-center gap-2 text-[11px] font-black"><CalendarClock size={14}/>Coming up</div>{data.upcoming.length===0?<p className="text-[10px] leading-5 text-[#77766d]">Add a study block or exam date to see what&apos;s next.</p>:<div className="space-y-2">{data.upcoming.slice(0,3).map((item)=><div key={item.id} className="rounded-lg border border-black/10 p-3"><div className="text-[10px] font-bold">{item.title}</div><div className="mt-1 text-[9px] text-[#737168]">{item.subject} · {new Date(item.starts_at).toLocaleString()}</div></div>)}</div>}</article>
      <article className="rounded-2xl border border-black/20 bg-[#fffef8] p-4"><div className="mb-3 flex items-center gap-2 text-[11px] font-black"><Check size={14}/>Daily quests</div>{data.quests.length===0?<p className="text-[10px] leading-5 text-[#77766d]">Your study activity will set your daily quests.</p>:<div className="space-y-3">{data.quests.slice(0,3).map((quest)=><div key={quest.id}><div className="flex items-start justify-between gap-2 text-[9px]"><span className="font-semibold">{quest.title}</span><span className="shrink-0 text-[#72741e]">+{quest.xp_reward} XP</span></div><div className="mt-1.5 h-1.5 rounded-full bg-[#e8e6d9]"><div className="h-full rounded-full bg-[#c7d326]" style={{width:`${Math.min(100,Math.max(0,quest.progress/Math.max(1,quest.target)*100))}%`}}/></div></div>)}</div>}</article>
    </section>
  </>;
}
