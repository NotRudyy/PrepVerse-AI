"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, LoaderCircle, Monitor, Moon, ShieldCheck, Sparkles, Sun } from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { type Theme } from "@/components/theme-context";
import { useTheme } from "@/components/use-theme";
import { ApiError, apiRequest } from "@/lib/api";

type UserInfo = { username: string; email: string; display_name: string; ai_data_consent: boolean; xp_balance: number };

const themeOptions: Array<{ id: Theme; label: string; description: string; Icon: typeof Sun }> = [
  { id: "light", label: "Light", description: "Always use the light palette", Icon: Sun },
  { id: "dark", label: "Dark", description: "Always use the dark palette", Icon: Moon },
  { id: "system", label: "Auto detect", description: "Light 5 a.m.–5 p.m.; dark 5 p.m.–5 a.m.", Icon: Monitor },
];

export default function SettingsPage() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiRequest<{ user: UserInfo }>("/auth/me").then((result) => {
      setUser(result.user);
      setConsent(result.user.ai_data_consent);
    }).catch((cause: unknown) => {
      if (cause instanceof ApiError && cause.status === 401) router.replace("/login");
      else setError(cause instanceof Error ? cause.message : "Settings could not be loaded.");
    });
  }, [router]);

  async function saveConsent() {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const result = await apiRequest<{ ai_data_consent: boolean }>("/settings/ai-consent", {
        method: "PATCH",
        body: JSON.stringify({ enabled: consent }),
      });
      setConsent(result.ai_data_consent);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The privacy setting could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="site-frame app-frame min-h-[calc(100vh-60px)]"><div className="lg:flex"><AppSidebar active="/settings"/><main className="min-w-0 flex-1 bg-[#f6f4eb] px-4 py-5 sm:px-7 sm:py-7 lg:px-9">
    <Link href="/dashboard" className="mb-5 inline-flex items-center gap-2 text-[10px] font-semibold text-[#66655d]"><ArrowLeft size={13}/> Dashboard</Link>
    <header className="mb-6"><div className="text-[9px] font-bold uppercase tracking-[.16em] text-[#777823]">YOUR ACCOUNT</div><h1 className="display-type mt-1 text-4xl leading-none sm:text-5xl">Settings</h1></header>
    {error && <div role="alert" className="mb-4 rounded-xl border border-[#a24127]/30 bg-[#a24127]/5 p-3 text-[10px] text-[#842d18]">{error}</div>}
    {!user ? <div className="rounded-xl border border-black/20 bg-white/70 p-5 text-[11px] text-[#77766d]">Loading your settings…</div> : <div className="grid max-w-3xl gap-4">
      <section className="rounded-2xl border border-black/20 bg-[#fffef8] p-5 sm:p-6">
        <div className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-[#efff4f]"><Sun size={18}/></span><div><h2 className="text-[13px] font-black">Appearance</h2><p className="mt-1 text-[9px] text-[#77766d]">Choose how PrepVerse looks on this device.</p></div></div>
        <div role="radiogroup" aria-label="Theme mode" className="mt-5 grid gap-2 sm:grid-cols-3">
          {themeOptions.map(({ id, label, description, Icon }) => <button key={id} type="button" role="radio" aria-checked={theme === id} onClick={() => setTheme(id)} className={`focus-ring rounded-xl border p-3 text-left transition ${theme === id ? "border-black bg-[#f1efdf] shadow-[2px_2px_0_#10100f]" : "border-black/15 hover:bg-black/5"}`}><span className="flex items-center gap-2 text-[11px] font-bold"><Icon size={15}/>{label}</span><span className="mt-1 block text-[9px] leading-4 text-[#77766d]">{description}</span></button>)}
        </div>
      </section>

      <section className="rounded-2xl border border-black/20 bg-[#fffef8] p-5 sm:p-6">
        <div className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-[#efff4f]"><ShieldCheck size={18}/></span><div><h2 className="text-[13px] font-black">Account</h2><p className="mt-1 text-[9px] text-[#77766d]">Your PrepVerse sign-in</p></div></div>
        <dl className="mt-5 grid gap-3 border-t border-black/10 pt-4 sm:grid-cols-2"><div><dt className="text-[9px] text-[#77766d]">Username</dt><dd className="mt-1 text-[11px] font-bold">{user.username}</dd></div><div><dt className="text-[9px] text-[#77766d]">Email</dt><dd className="mt-1 break-all text-[11px] font-bold">{user.email}</dd></div><div><dt className="text-[9px] text-[#77766d]">XP balance</dt><dd className="mt-1 text-[11px] font-bold">{user.xp_balance} XP</dd></div></dl>
      </section>

      <section className="rounded-2xl border-2 border-black bg-[#fffef8] p-5 shadow-[3px_3px_0_#10100f] sm:p-6">
        <div className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-[#efff4f]"><Sparkles size={18}/></span><div><h2 className="text-[13px] font-black">AI study features</h2><p className="mt-1 text-[9px] text-[#77766d]">Control whether your content can be sent to Google's Gemini API.</p></div></div>
        <label className="mt-5 flex items-start gap-3 rounded-xl border border-black/15 bg-[#f6f4eb] p-4 text-[10px] leading-5"><input type="checkbox" checked={consent} onChange={(event) => { setConsent(event.target.checked); setSaved(false); }} className="mt-1 size-4 shrink-0 accent-black"/><span><strong>{consent ? "AI features enabled" : "AI features disabled"}.</strong> When enabled, text from your materials, messages, answers, and voice recordings may be sent to Gemini for tutoring, topic extraction, practice, and transcription. Google's free tier says submitted content may be used to improve its products. Turning this off prevents future Gemini calls; it does not remove files already uploaded to PrepVerse. <a href="https://ai.google.dev/gemini-api/docs/pricing" target="_blank" rel="noreferrer" className="font-bold underline underline-offset-2">Google Gemini API data terms</a>.</span></label>
        <div className="mt-4 flex items-center gap-3"><button disabled={busy || consent === user.ai_data_consent} onClick={() => void saveConsent()} className="black-button focus-ring inline-flex h-10 items-center gap-2 rounded-lg px-4 text-[10px] font-bold disabled:opacity-45">{busy ? <LoaderCircle className="animate-spin" size={13}/> : <Check size={13}/>} Save privacy choice</button>{saved && <span role="status" className="text-[9px] text-[#535500]">Saved.</span>}</div>
      </section>

      <section className="rounded-2xl border border-black/20 bg-[#fffef8] p-5"><h2 className="text-[12px] font-black">Study material</h2><p className="mt-2 text-[10px] leading-5 text-[#77766d]">Uploads are stored in the PrepVerse service and linked to your account. Manage your documents and subject outline in StudyPacks.</p><Link href="/study-packs" className="mt-3 inline-flex items-center gap-2 text-[10px] font-bold underline underline-offset-2">Open StudyPacks <ArrowLeft size={12} className="rotate-180"/></Link></section>
    </div>}
  </main></div></div>;
}
