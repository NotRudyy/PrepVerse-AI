"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, BookOpen, FilePlus2, FileText, FolderOpen, LoaderCircle, Pin, PinOff, Plus, Sparkles, Upload, X } from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { ApiError, apiRequest, apiUrl } from "@/lib/api";

type Topic = { id: string; title: string; importance: string; mastery: number };
type Subject = { id: string; name: string; pinned: boolean; topics: Topic[] };
type Material = { id: string; filename: string; subject: string; status: string; created_at: string; topic_count: number; mastered_topics: number; progress_percent: number; in_progress: boolean };
type PackResponse = { items: Material[]; subjects: Subject[]; stats: { materials: number; notes_imported: number; concepts_mapped: number; recall_cards: number } };
type Tab = "all" | "progress" | "recent";

function normalizePackResponse(value: Partial<PackResponse>): PackResponse {
  return {
    items: Array.isArray(value.items) ? value.items : [],
    subjects: Array.isArray(value.subjects)
      ? value.subjects.map((subject) => ({ ...subject, topics: Array.isArray(subject.topics) ? subject.topics : [] }))
      : [],
    stats: {
      materials: value.stats?.materials ?? 0,
      notes_imported: value.stats?.notes_imported ?? 0,
      concepts_mapped: value.stats?.concepts_mapped ?? 0,
      recall_cards: value.stats?.recall_cards ?? 0,
    },
  };
}

export default function StudyPacksPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [data, setData] = useState<PackResponse | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [subjectChoice, setSubjectChoice] = useState("auto");
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [subjectName, setSubjectName] = useState("");
  const [topicName, setTopicName] = useState("");
  const [selectedSubject, setSelectedSubject] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      const result = normalizePackResponse(await apiRequest<Partial<PackResponse>>("/study-packs"));
      setData(result);
      setSelectedSubject((current) => current || result.subjects[0]?.id || "");
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) router.replace("/login");
      else setError(cause instanceof Error ? cause.message : "Your study materials could not be loaded.");
    }
  }

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function uploadSelected() {
    const supported = files.filter((file) => /\.(pdf|pptx|docx)$/i.test(file.name));
    if (supported.length !== files.length) setMessage("Only PDF, PPTX, and DOCX files can be uploaded. Unsupported files were skipped.");
    if (!supported.length) { setError("Choose at least one PDF, PPTX, or DOCX file."); return; }
    if (apiUrl.startsWith("/") && supported.some((file) => file.size > 4 * 1024 * 1024)) { setError("On the hosted app, each file must be 4 MB or smaller."); return; }
    setUploading(true); setError("");
    const uploaded: string[] = [];
    const warnings: string[] = [];
    try {
      for (const file of supported) {
        const form = new FormData();
        form.append("file", file);
        form.append("subject", subjectChoice);
        form.append("relative_path", (file as File & { webkitRelativePath?: string }).webkitRelativePath || "");
        const result = await apiRequest<{ material: { filename: string; subject: string }; warning?: string | null }>("/materials", { method: "POST", body: form });
        uploaded.push(`${result.material.filename} → ${result.material.subject}`);
        if (result.warning) warnings.push(`${file.name}: ${result.warning}`);
      }
      setMessage(`Imported ${uploaded.length} document${uploaded.length === 1 ? "" : "s"}: ${uploaded.join(" · ")}${warnings.length ? `\nAI analysis notice: ${warnings.join(" · ")}` : ""}`);
      setFiles([]);
      if (inputRef.current) inputRef.current.value = "";
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The upload could not be completed.");
      if (uploaded.length) setMessage(`${uploaded.length} document${uploaded.length === 1 ? " was" : "s were"} saved before an error occurred.`);
      await load();
    } finally { setUploading(false); }
  }

  async function addSubject(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const subject = await apiRequest<{ id: string }>("/subjects", { method: "POST", body: JSON.stringify({ name: subjectName }) });
      setSubjectName(""); setSelectedSubject(subject.id); setMessage("Subject added to your study space."); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Subject could not be added."); }
    finally { setBusy(false); }
  }

  async function addTopic(event: FormEvent) {
    event.preventDefault(); if (!selectedSubject) return;
    setBusy(true); setError("");
    try {
      await apiRequest(`/subjects/${selectedSubject}/topics`, { method: "POST", body: JSON.stringify({ title: topicName }) });
      setTopicName(""); setMessage("Topic added to your study outline."); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Topic could not be added."); }
    finally { setBusy(false); }
  }

  async function togglePin(subject: Subject) {
    setBusy(true); setError("");
    try { await apiRequest(`/subjects/${subject.id}/pin`, { method: "PATCH", body: JSON.stringify({ pinned: !subject.pinned }) }); setMessage(`${subject.name} ${subject.pinned?"unpinned":"pinned"} on your dashboard.`); await load(); }
    catch(cause) { setError(cause instanceof Error?cause.message:"Subject pin could not be changed."); }
    finally { setBusy(false); }
  }

  const materials = data?.items ?? [];
  const shown = tab === "progress" ? materials.filter((row) => row.in_progress) : tab === "recent" ? materials.slice(0, 5) : materials;

  return <div className="site-frame app-frame min-h-[calc(100vh-60px)]"><div className="lg:flex">
    <AppSidebar active="/study-packs"/>
    <main className="min-w-0 flex-1 bg-[#f6f4eb] px-4 py-5 sm:px-7 sm:py-7 lg:px-9">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><div className="text-[9px] font-bold uppercase tracking-[.16em] text-[#777823]">YOUR COURSE LIBRARY</div><h1 className="display-type mt-1 text-4xl leading-none sm:text-5xl">StudyPacks</h1><p className="mt-2 text-[11px] text-[#66655d]">Bring your own syllabus and documents. Drift AI uses only the material in your account.</p></div><button onClick={() => inputRef.current?.click()} className="acid-button focus-ring inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[10px] font-bold"><Upload size={14}/> Choose documents</button></header>
      {error && <p role="alert" className="mb-4 rounded-xl border border-[#a24127]/35 bg-[#a24127]/5 p-3 text-[11px] text-[#842d18]">{error}</p>}
      {message && <p role="status" className="mb-4 rounded-xl border border-black/15 bg-white/70 p-3 text-[11px] text-[#4d4c46]">{message}</p>}

      <section className="mb-5 grid gap-3 sm:grid-cols-4" aria-label="Study pack totals">
        {[{label:"Materials",value:data?.stats.materials ?? "—"},{label:"Notes imported",value:data?.stats.notes_imported ?? "—"},{label:"Concepts mapped",value:data?.stats.concepts_mapped ?? "—"},{label:"Recall cards",value:data?.stats.recall_cards ?? "—"}].map((item)=><article key={item.label} className="rounded-2xl border border-black/20 bg-[#fffef8] p-4"><div className="text-[9px] font-semibold text-[#737168]">{item.label}</div><div className="mt-2 text-2xl font-black">{item.value}</div></article>)}
      </section>

      <section className="mb-5 grid gap-4 xl:grid-cols-[1.3fr_.8fr]">
        <div className="rounded-2xl border-2 border-black bg-[#fffef8] p-4 shadow-[3px_3px_0_#10100f] sm:p-5">
          <div className="flex items-start justify-between gap-3"><div><h2 className="text-[13px] font-black">Import course documents</h2><p className="mt-1 text-[10px] leading-5 text-[#737168]">Accepted formats: PDF, PowerPoint (.pptx), and Word (.docx). Hosted uploads are limited to 4 MB per file. With AI consent enabled, Drift can sort from document contents and map topics; otherwise folder names and filenames guide sorting.</p></div><span className="flex size-9 items-center justify-center rounded-xl bg-[#efff4f]"><FolderOpen size={17}/></span></div>
          <input ref={inputRef} type="file" accept=".pdf,.pptx,.docx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.wordprocessingml.document" multiple onChange={(event)=>setFiles(Array.from(event.target.files ?? []))} className="sr-only" aria-label="Choose PDF, PPTX, or DOCX documents"/>
          <div onDragOver={(event)=>event.preventDefault()} onDrop={(event)=>{event.preventDefault();setFiles(Array.from(event.dataTransfer.files));}} className="mt-4 rounded-xl border border-dashed border-black/30 bg-[#f7f5ea] p-5 text-center">
            <FilePlus2 className="mx-auto" size={21}/><p className="mt-2 text-[10px] font-semibold">Drop documents here, or <button type="button" className="underline underline-offset-2" onClick={()=>inputRef.current?.click()}>browse your files</button></p><p className="mt-1 text-[9px] text-[#77766d]">Each file is private to your PrepVerse account.</p>
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row"><select value={subjectChoice} onChange={(event)=>setSubjectChoice(event.target.value)} className="focus-ring h-10 flex-1 rounded-lg border border-black/20 bg-transparent px-3 text-[10px]"><option value="auto">Sort automatically using folder, filename, and subjects</option>{(data?.subjects ?? []).map((subject)=><option key={subject.id} value={subject.name}>{subject.name}</option>)}</select><button disabled={!files.length||uploading} onClick={()=>void uploadSelected()} className="black-button focus-ring flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-[10px] font-bold disabled:opacity-45">{uploading?<><LoaderCircle className="animate-spin" size={13}/> Importing…</>:<><Upload size={13}/> Import {files.length || "documents"}</>}</button></div>
          {files.length > 0 && <ul className="mt-3 space-y-1.5">{files.map((file,index)=><li key={`${file.name}-${index}`} className="flex items-center justify-between gap-3 rounded-lg bg-[#f3f1e7] px-3 py-2 text-[9px]"><span className="flex min-w-0 items-center gap-2"><FileText size={13}/><span className="truncate">{(file as File & {webkitRelativePath?:string}).webkitRelativePath || file.name}</span></span><button aria-label={`Remove ${file.name}`} onClick={()=>setFiles(current=>current.filter((_,i)=>i!==index))} className="rounded p-1 hover:bg-black/10"><X size={12}/></button></li>)}</ul>}
          <details className="mt-3 text-[9px] text-[#737168]"><summary className="cursor-pointer font-semibold">Upload a subject folder</summary><p className="mt-2 leading-4">Use “Choose subject folder” to upload a folder and let its name guide sorting.</p><label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-black/20 px-3 py-2 font-semibold text-black"><FolderOpen size={13}/> Choose subject folder<input type="file" multiple className="sr-only" {...{webkitdirectory:""}} onChange={(event)=>setFiles(Array.from(event.target.files ?? []))}/></label></details>
        </div>
        <div className="rounded-2xl border border-black/20 bg-[#10100f] p-5 text-[#f2f0e5]"><div className="flex items-center gap-2 text-[12px] font-black"><span className="flex size-7 items-center justify-center rounded-lg bg-[#efff4f] text-black"><Sparkles size={14}/></span>Or start from your syllabus</div><p className="mt-2 text-[10px] leading-5 text-white/65">Add subjects and topics manually if you do not have digital documents. Drift AI will use that outline as its study context.</p>
          <form onSubmit={addSubject} className="mt-4 flex gap-2"><input required maxLength={140} value={subjectName} onChange={(e)=>setSubjectName(e.target.value)} placeholder="Add a subject" className="focus-ring h-10 min-w-0 flex-1 rounded-lg border border-white/20 bg-white/5 px-3 text-[10px] text-white placeholder:text-white/45"/><button disabled={busy} className="flex size-10 items-center justify-center rounded-lg bg-[#efff4f] text-black disabled:opacity-50" aria-label="Add subject"><Plus size={16}/></button></form>
          <form onSubmit={addTopic} className="mt-2 flex gap-2"><select required value={selectedSubject} onChange={(e)=>setSelectedSubject(e.target.value)} className="focus-ring h-10 min-w-0 flex-1 rounded-lg border border-white/20 bg-[#10100f] px-3 text-[10px] text-white"><option value="">Choose subject</option>{(data?.subjects ?? []).map((subject)=><option key={subject.id} value={subject.id}>{subject.name}</option>)}</select><input required maxLength={180} value={topicName} onChange={(e)=>setTopicName(e.target.value)} placeholder="Important topic" className="focus-ring h-10 min-w-0 flex-1 rounded-lg border border-white/20 bg-white/5 px-3 text-[10px] text-white placeholder:text-white/45"/><button disabled={busy||!selectedSubject} className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-white/30 disabled:opacity-40" aria-label="Add topic"><Plus size={16}/></button></form>
          <div className="mt-5 max-h-44 space-y-2 overflow-y-auto">{(data?.subjects ?? []).map(subject=><div key={subject.id} className="rounded-lg border border-white/10 p-3"><div className="flex items-center justify-between gap-2 text-[10px] font-bold"><span>{subject.name}</span><div className="flex items-center gap-2 text-white/45"><span>{subject.topics.length} topics</span><button type="button" disabled={busy} onClick={()=>void togglePin(subject)} aria-label={subject.pinned?`Unpin ${subject.name}`:`Pin ${subject.name}`} className="focus-ring rounded p-1 text-white hover:bg-white/10">{subject.pinned?<PinOff size={12}/>:<Pin size={12}/>}</button></div></div>{subject.topics.length>0&&<p className="mt-1 line-clamp-2 text-[9px] text-white/55">{subject.topics.map(topic=>topic.title).join(" · ")}</p>}</div>)}</div>
        </div>
      </section>

      <section className="rounded-2xl border border-black/20 bg-[#fffef8] p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-[13px] font-black">Your materials</h2><p className="mt-1 text-[9px] text-[#737168]">Subject, import status, and learning progress come from your account data.</p></div><div className="flex gap-1 rounded-xl border border-black/15 p-1">{([{id:"all",label:"All materials"},{id:"progress",label:"In progress"},{id:"recent",label:"Recently added"}] as const).map(option=><button key={option.id} onClick={()=>setTab(option.id)} className={`focus-ring rounded-lg px-3 py-2 text-[9px] font-bold ${tab===option.id?"bg-black text-white":"text-[#737168] hover:bg-black/5"}`}>{option.label}</button>)}</div></div>
        {!data ? <div className="mt-4 rounded-xl bg-[#f3f1e7] p-5 text-center text-[10px] text-[#77766d]">Loading your materials…</div> : shown.length===0 ? <div className="mt-4 rounded-xl border border-dashed border-black/25 p-8 text-center"><BookOpen className="mx-auto" size={22}/><p className="mt-3 text-[11px] font-bold">{tab==="progress"?"No materials with mapped topics are in progress.":materials.length?"No documents in this view yet.":"Your library is empty."}</p><p className="mt-1 text-[9px] text-[#77766d]">{tab==="progress"?"Mapped topics appear here until your mastery reaches 80%. Add topics or practice a set to update progress.":"Upload course notes or add your subject outline to begin."}</p><Link href="/drift" className="mt-3 inline-flex items-center gap-2 text-[10px] font-bold underline underline-offset-2">Open Drift AI <ArrowRight size={12}/></Link></div> : <div className="mt-4 grid gap-2 sm:grid-cols-2">{shown.map(item=><article key={item.id} className="flex items-center gap-3 rounded-xl border border-black/10 p-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#efff4f]"><FileText size={16}/></span><div className="min-w-0 flex-1"><div className="truncate text-[10px] font-bold">{item.filename}</div><div className="mt-1 text-[9px] text-[#737168]">{item.subject} · {item.topic_count?`${item.mastered_topics}/${item.topic_count} topics mastered · ${item.progress_percent}% mastery`:item.status} · {new Date(item.created_at).toLocaleDateString()}</div>{tab==="progress"&&<div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/10" role="progressbar" aria-label={`${item.subject} learning mastery`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={item.progress_percent}><div className="h-full rounded-full bg-[#8c9200]" style={{width:`${item.progress_percent}%`}}/></div>}</div><span className="size-2 rounded-full bg-[#738000]" title={item.status}/></article>)}</div>}
      </section>
    </main>
  </div></div>;
}
