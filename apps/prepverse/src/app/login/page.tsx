"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, BookOpen, Github, Eye, EyeOff, LockKeyhole, Mail, UserRound } from "lucide-react";
import { apiConfigured, apiRequest, apiUrl } from "@/lib/api";

type Mode = "signin" | "signup";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<{google:boolean;github:boolean}|null>(null);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("mode") === "signup") setMode("signup");
    const query = new URLSearchParams(window.location.search);
    const authError = query.get("error");
    if (authError) setMessage(authError.replaceAll("_", " "));
    apiRequest<{ google: boolean; github: boolean }>("/auth/providers").then(setProviders).catch(() => setProviders(null));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setBusy(true);
    try {
      const endpoint = mode === "signup" ? "/auth/register" : "/auth/login";
      const result = await apiRequest<{ onboarding_required: boolean }>(endpoint, {
        method: "POST",
        body: JSON.stringify(mode === "signup"
          ? { username: username.trim(), email: email.trim().toLowerCase(), password, remember_me: remember }
          : { identifier: username.trim(), password, remember_me: remember }),
      });
      const next = new URLSearchParams(window.location.search).get("next");
      const safeNext = next?.startsWith("/") && !next.startsWith("//") ? next : null;
      const onboardingUrl = safeNext ? `/onboarding?next=${encodeURIComponent(safeNext)}` : "/onboarding";
      router.push(mode === "signup" || result.onboarding_required ? onboardingUrl : safeNext || "/dashboard");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "We couldn't sign you in. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function providerStart(provider: "google" | "github") {
    if (!apiConfigured) {
      setMessage("Secure sign-in is not configured yet. Please try again after PrepVerse setup is complete.");
      return;
    }
    window.location.assign(`${apiUrl}/auth/${provider}/start`);
  }

  return <main className="site-frame grid min-h-[calc(100vh-60px)] place-items-center p-4 sm:p-8">
    <div className="grid w-full max-w-[1020px] overflow-hidden rounded-[24px] border-2 border-black bg-[#fffef8] shadow-[8px_8px_0_#10100f] md:min-h-[650px] md:grid-cols-[.9fr_1.1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-[#10100f] p-9 text-[#f2f0e5] md:flex lg:p-12">
        <div className="paper-grid absolute inset-0 opacity-[.15]" />
        <Link href="/" className="relative z-[1] flex items-center gap-2 text-[19px] font-black tracking-[-.06em]">PrepVerse <span className="text-[#efff4f]">AI</span></Link>
        <div className="relative z-[1] my-12">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-2 text-[9px] font-bold tracking-[.13em]"><BookOpen size={12}/> YOUR STUDY SPACE</div>
          <h1 className="display-type text-[clamp(3rem,5vw,5.4rem)] leading-[.87]">Make room<br/>for your next<br/><span className="text-[#efff4f]">aha.</span></h1>
          <p className="mt-6 max-w-[320px] text-[13px] leading-6 text-white/65">Keep your course materials close, your practice focused, and your learning moving forward.</p>
        </div>
        <div className="relative z-[1] flex items-center gap-2 text-[10px] text-white/55"><span className="flex size-7 items-center justify-center rounded-full bg-[#efff4f] text-black"><LockKeyhole size={13}/></span> Your account, materials, and progress stay connected.</div>
        <span className="absolute -bottom-16 -right-12 size-64 rounded-full border border-[#efff4f]/50" />
      </section>

      <section className="flex flex-col justify-center p-6 sm:p-10 lg:p-14">
        <Link href="/" className="focus-ring mb-8 inline-flex w-fit items-center gap-2 text-[11px] font-semibold text-[#5e5d55]"><ArrowLeft size={14}/> Back to PrepVerse</Link>
        <div className="mb-6">
          <div className="text-[10px] font-black uppercase tracking-[.16em] text-[#737522]">{mode === "signin" ? "WELCOME BACK" : "START YOUR STUDY SPACE"}</div>
          <h2 className="mt-2 text-[30px] font-black tracking-[-.06em]">{mode === "signin" ? "Sign in" : "Create your account"}</h2>
          <p className="mt-2 text-[12px] leading-5 text-[#68675f]">{mode === "signin" ? "Use your PrepVerse username or a connected account." : "Choose a username and connect the account you want to use."}</p>
        </div>

        <div className="mb-5 grid grid-cols-2 rounded-xl border border-black/20 p-1">
          {([{ id: "signin", label: "Sign in" }, { id: "signup", label: "Create account" }] as const).map((item) => <button key={item.id} type="button" onClick={() => { setMode(item.id); setMessage(""); }} className={`focus-ring rounded-lg px-3 py-2.5 text-[11px] font-bold transition ${mode === item.id ? "bg-black text-white" : "text-[#68675f] hover:bg-black/5"}`}>{item.label}</button>)}
        </div>

        <form onSubmit={submit} className="space-y-3.5">
          <label className="block text-[10px] font-semibold text-[#4d4c46]">
            {mode === "signin" ? "Username or email" : "Choose a username"}
            <span className="relative mt-1.5 block"><UserRound size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#818077]"/><input autoComplete="username" required value={username} onChange={(event) => setUsername(event.target.value)} placeholder={mode === "signin" ? "Your username or email" : "A name you'll remember"} className="focus-ring h-12 w-full rounded-xl border border-black/25 bg-transparent pl-10 pr-3 text-[12px] font-normal outline-none placeholder:text-[#97968d] focus:border-black" /></span>
          </label>
          {mode === "signup" && <label className="block text-[10px] font-semibold text-[#4d4c46]">Email address<span className="relative mt-1.5 block"><Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#818077]"/><input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" className="focus-ring h-12 w-full rounded-xl border border-black/25 bg-transparent pl-10 pr-3 text-[12px] font-normal outline-none placeholder:text-[#97968d] focus:border-black" /></span></label>}
          <label className="block text-[10px] font-semibold text-[#4d4c46]">Password<span className="relative mt-1.5 block"><LockKeyhole size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#818077]"/><input type={showPassword ? "text" : "password"} autoComplete={mode === "signup" ? "new-password" : "current-password"} required minLength={mode === "signup" ? 10 : 1} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === "signup" ? "At least 10 characters" : "Your password"} className="focus-ring h-12 w-full rounded-xl border border-black/25 bg-transparent pl-10 pr-11 text-[12px] font-normal outline-none placeholder:text-[#97968d] focus:border-black"/><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((value) => !value)} className="focus-ring absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-[#6a695f]">{showPassword ? <EyeOff size={15}/> : <Eye size={15}/>}</button></span></label>
          <label className="flex items-center gap-2 text-[10px] text-[#68675f]"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} className="size-3.5 accent-black"/> Keep me signed in on this device</label>
          {message && <div role="alert" className="rounded-xl border border-[#a24127]/35 bg-[#a24127]/5 px-3.5 py-3 text-[11px] leading-5 text-[#842d18]">{message}</div>}
          <button disabled={busy} type="submit" className="black-button focus-ring flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[12px] font-bold disabled:cursor-wait disabled:opacity-65">{busy ? "Connecting securely…" : mode === "signin" ? "Sign in to PrepVerse" : "Create account"}<ArrowRight size={15}/></button>
        </form>

        <div className="my-5 flex items-center gap-3 text-[9px] font-semibold text-[#85847b]"><span className="h-px flex-1 bg-black/15"/>OR CONTINUE WITH<span className="h-px flex-1 bg-black/15"/></div>
        <div className="grid grid-cols-2 gap-3">
          <button type="button" disabled={!providers?.google} onClick={() => providerStart("google")} title={!providers?.google?"Connect the PrepVerse service and configure Google OAuth":"Continue with Google"} className="focus-ring flex h-11 items-center justify-center gap-2 rounded-xl border border-black/25 text-[11px] font-semibold transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-45"><span className="text-[15px] font-black">G</span> Google</button>
          <button type="button" disabled={!providers?.github} onClick={() => providerStart("github")} title={!providers?.github?"Connect the PrepVerse service and configure GitHub OAuth":"Continue with GitHub"} className="focus-ring flex h-11 items-center justify-center gap-2 rounded-xl border border-black/25 text-[11px] font-semibold transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-45"><Github size={15}/> GitHub</button>
        </div>
        {providers&& !providers.google&&!providers.github&&<p className="mt-3 text-center text-[9px] text-[#77766d]">Google and GitHub sign-in buttons enable after the OAuth client credentials are configured for this deployment.</p>}
        {!providers&&<p className="mt-3 text-center text-[9px] text-[#77766d]">Provider availability appears when the PrepVerse service is connected.</p>}
        {!apiConfigured && <p className="mt-4 text-center text-[10px] leading-5 text-[#77766d]">Account sign-in needs the PrepVerse service URL. No local or demo accounts are created.</p>}
        <p className="mt-5 text-center text-[9px] leading-4 text-[#85847b]">Your browser may offer to save your username and password. PrepVerse will never store your password in your browser storage.</p>
      </section>
    </div>
  </main>;
}
