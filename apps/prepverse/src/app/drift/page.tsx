"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, BookOpen, LoaderCircle, Mic, MicOff, Sparkles, Volume2 } from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { ApiError, apiRequest } from "@/lib/api";

type Message = { id: string; role: "user" | "assistant"; content: string; created_at?: string };
type Subject = { id: string; name: string };

export default function DriftPage() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const [mode, setMode] = useState("learn");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([apiRequest<{items:Message[]}>("/tutor/history"), apiRequest<{items:Subject[]}>("/subjects")])
      .then(([history, subjectData]) => { setMessages(history.items); setSubjects(subjectData.items); })
      .catch((cause: unknown) => { if (cause instanceof ApiError && cause.status === 401) router.replace("/login"); else setError(cause instanceof Error ? cause.message : "Drift AI is unavailable."); });
    return () => { stream.current?.getTracks().forEach((track)=>track.stop()); };
  }, [router]);

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [messages, busy]);

  async function ask(question: string) {
    const clean = question.trim(); if (!clean || busy) return;
    setText(""); setError(""); setBusy(true);
    const localUser: Message = { id: crypto.randomUUID(), role: "user", content: clean };
    setMessages((current)=>[...current,localUser]);
    try {
      const response = await apiRequest<{answer:string}>("/tutor/chat", { method: "POST", body: JSON.stringify({ message: clean, subject_id: subjectId || null, mode }) });
      setMessages((current)=>[...current,{id:crypto.randomUUID(),role:"assistant",content:response.answer}]);
    } catch (cause) {
      setMessages((current)=>current.filter((item)=>item.id!==localUser.id));
      setText(clean); setError(cause instanceof Error ? cause.message : "Drift AI could not answer this right now.");
    } finally { setBusy(false); }
  }

  async function startMic() {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { setError("Audio recording is not available in this browser. Try a current browser over HTTPS."); return; }
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = mic;
      const audioRecorder = new MediaRecorder(mic);
      const chunks: BlobPart[] = [];
      audioRecorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      audioRecorder.onstop = async () => {
        const blob = new Blob(chunks, { type: audioRecorder.mimeType || "audio/webm" });
        mic.getTracks().forEach((track)=>track.stop()); stream.current = null; setBusy(true);
        const form = new FormData(); form.append("audio", blob, "drift-question.webm"); if (subjectId) form.append("subject_id", subjectId);
        try {
          const result = await apiRequest<{transcript:string;answer:string}>("/voice/tutor", {method:"POST",body:form});
          setMessages((current)=>[...current,{id:crypto.randomUUID(),role:"user",content:result.transcript},{id:crypto.randomUUID(),role:"assistant",content:result.answer}]);
        } catch (cause) { setError(cause instanceof Error?cause.message:"Audio question could not be processed."); }
        finally { setBusy(false); }
      };
      recorder.current = audioRecorder; audioRecorder.start(); setRecording(true);
    } catch { setError("Microphone access was not granted. Allow it in your browser settings and try again."); }
  }

  function stopMic() { recorder.current?.stop(); setRecording(false); }

  return <div className="site-frame app-frame min-h-[calc(100vh-60px)]"><div className="lg:flex"><AppSidebar active="/drift"/><main className="flex min-w-0 flex-1 flex-col bg-[#f6f4eb] px-4 py-5 sm:px-7 sm:py-7 lg:h-[calc(100vh-82px)] lg:px-9">
    <header className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><div className="text-[9px] font-bold uppercase tracking-[.16em] text-[#777823]">STUDY WITH YOUR COURSE CONTEXT</div><h1 className="display-type mt-1 text-4xl leading-none sm:text-5xl">Drift AI</h1><p className="mt-2 text-[11px] text-[#66655d]">Ask questions, request a hint, or prepare an exam answer from your uploaded notes.</p></div><div className="flex items-center gap-2"><label className="sr-only" htmlFor="drift-subject">Subject</label><select id="drift-subject" value={subjectId} onChange={(event)=>setSubjectId(event.target.value)} className="focus-ring h-10 max-w-44 rounded-lg border border-black/20 bg-transparent px-3 text-[10px]"><option value="">All my course material</option>{subjects.map((subject)=><option key={subject.id} value={subject.id}>{subject.name}</option>)}</select><select value={mode} onChange={(event)=>setMode(event.target.value)} aria-label="Tutor style" className="focus-ring h-10 rounded-lg border border-black/20 bg-transparent px-3 text-[10px]"><option value="learn">Explain</option><option value="hint">Give me a hint</option><option value="socratic">Coach me</option><option value="exam">Exam answer</option></select></div></header>
    <section className="flex min-h-[420px] flex-1 flex-col overflow-hidden rounded-2xl border border-black/20 bg-[#fffef8]">
      <div className="flex items-center justify-between border-b border-black/10 px-4 py-3"><div className="flex items-center gap-2 text-[10px] font-bold"><span className="flex size-7 items-center justify-center rounded-lg bg-[#efff4f]"><Sparkles size={14}/></span>Drift AI · PrepVerse tutor</div><span className="inline-flex items-center gap-1.5 text-[9px] text-[#77766d]"><BookOpen size={12}/>{subjectId?subjects.find(x=>x.id===subjectId)?.name:"Your materials"}</span></div>
      <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6" aria-live="polite">
        {messages.length===0&&<div className="mx-auto mt-8 max-w-md text-center"><span className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-black bg-[#efff4f]"><Sparkles size={21}/></span><h2 className="mt-4 text-[14px] font-black">What would you like to understand?</h2><p className="mt-2 text-[10px] leading-5 text-[#737168]">Drift uses the notes in your account for course-grounded answers. Upload study materials first if you have not added any.</p><div className="mt-4 flex flex-wrap justify-center gap-2"><button onClick={()=>setText("Explain one concept from my course notes with an everyday example.")} className="rounded-full border border-black/20 px-3 py-2 text-[9px] hover:bg-black/5">Explain with an example</button><button onClick={()=>setText("Which important topics should I review from my course notes?")} className="rounded-full border border-black/20 px-3 py-2 text-[9px] hover:bg-black/5">Find topics to review</button></div></div>}
        {messages.map((item)=><div key={item.id} className={`flex ${item.role==="user"?"justify-end":"justify-start"}`}><article className={`max-w-[85%] rounded-2xl px-4 py-3 text-[11px] leading-6 ${item.role==="user"?"rounded-br-sm bg-black text-white":"rounded-bl-sm border border-black/10 bg-[#f4f2e8]"}`}><div className="mb-1 text-[8px] font-black uppercase tracking-[.13em] opacity-55">{item.role==="user"?"You":"Drift AI"}</div><p className="whitespace-pre-wrap">{item.content}</p></article></div>)}
        {busy&&<div role="status" className="flex items-center gap-2 text-[10px] text-[#77766d]"><LoaderCircle className="animate-spin" size={14}/>Drift is working from your course context…</div>}
      </div>
      {error&&<div role="alert" className="mx-4 mb-3 rounded-lg border border-[#a24127]/30 bg-[#a24127]/5 p-3 text-[10px] text-[#842d18]">{error} {error.includes("Turn on AI data use")&&<a href="/settings" className="ml-1 font-bold underline">Open Settings</a>}</div>}
      <form onSubmit={(event:FormEvent)=>{event.preventDefault();void ask(text);}} className="border-t border-black/10 p-3 sm:p-4"><div className="flex items-end gap-2 rounded-xl border border-black/25 bg-[#f9f7ee] p-2"><textarea value={text} onChange={(event)=>setText(event.target.value)} onKeyDown={(event)=>{if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();void ask(text);}}} rows={2} placeholder="Ask about a topic in your material…" aria-label="Message Drift AI" className="focus-ring min-h-[52px] flex-1 resize-y bg-transparent px-2 py-1 text-[11px] outline-none placeholder:text-[#8a897f]"/><button type="button" onClick={()=>recording?stopMic():void startMic()} disabled={busy} aria-label={recording?"Stop microphone recording":"Ask Drift AI with microphone"} className={`focus-ring flex size-10 shrink-0 items-center justify-center rounded-lg border border-black/20 ${recording?"bg-[#a24127] text-white":"hover:bg-black/5"}`}>{recording?<MicOff size={16}/>:<Mic size={16}/>}</button><button disabled={!text.trim()||busy} className="black-button focus-ring flex size-10 shrink-0 items-center justify-center rounded-lg disabled:opacity-40" aria-label="Send message"><ArrowUp size={17}/></button></div><div className="mt-2 flex items-center justify-between px-1 text-[8px] text-[#77766d]"><span className="inline-flex items-center gap-1"><Volume2 size={11}/>AI responses can be wrong; check your course notes.</span><span>Enter to send · Shift + Enter for a new line</span></div></form>
    </section>
  </main></div></div>;
}
