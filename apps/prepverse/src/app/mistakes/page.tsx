"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BookCheck, Check, LoaderCircle, RotateCcw } from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { ApiError, apiRequest } from "@/lib/api";

type Mistake={id:string;subject:string;question:string;answer:string;evaluation:string;reviewed:boolean};
export default function MistakesPage(){
  const router=useRouter();const [items,setItems]=useState<Mistake[]|null>(null);const [error,setError]=useState("");const [busy,setBusy]=useState("");
  async function load(){try{const result=await apiRequest<{items:Mistake[]}>("/mistakes");setItems(result.items);}catch(cause){if(cause instanceof ApiError&&cause.status===401)router.replace("/login");else setError(cause instanceof Error?cause.message:"Your mistake review could not be loaded.");}}
  useEffect(()=>{void load();},[]); // eslint-disable-line react-hooks/exhaustive-deps
  async function review(id:string){setBusy(id);setError("");try{await apiRequest(`/mistakes/${id}/review`,{method:"POST"});await load();}catch(cause){setError(cause instanceof Error?cause.message:"This item could not be marked reviewed.");}finally{setBusy("");}}
  const open=items?.filter(item=>!item.reviewed)??[];const done=items?.filter(item=>item.reviewed)??[];
  return <div className="site-frame app-frame min-h-[calc(100vh-60px)]"><div className="lg:flex"><AppSidebar active="/mistakes"/><main className="min-w-0 flex-1 bg-[#f6f4eb] px-4 py-5 sm:px-7 sm:py-7 lg:px-9">
    <header className="mb-6"><div className="text-[9px] font-bold uppercase tracking-[.16em] text-[#777823]">REVISIT AND REPAIR</div><h1 className="display-type mt-1 text-4xl leading-none sm:text-5xl">Mistake Lab</h1><p className="mt-2 text-[11px] text-[#66655d]">Wrong practice answers and written-response gaps are saved for review.</p></header>
    {error&&<p role="alert" className="mb-4 rounded-xl border border-[#a24127]/30 bg-[#a24127]/5 p-3 text-[10px] text-[#842d18]">{error}</p>}
    {!items?<div className="rounded-xl border border-black/20 bg-white/70 p-5 text-[10px] text-[#77766d]">Loading saved mistakes…</div>:<><section className="mb-5 rounded-2xl border border-black/20 bg-[#fffef8] p-5"><div className="flex items-center gap-2 text-[11px] font-black"><RotateCcw size={15}/>Needs another look <span className="ml-auto rounded-full bg-[#efff4f] px-2.5 py-1 text-[9px]">{open.length}</span></div>{open.length===0?<div className="mt-4 rounded-xl border border-dashed border-black/20 p-7 text-center"><BookCheck className="mx-auto" size={22}/><p className="mt-2 text-[11px] font-bold">Nothing waiting for review.</p><p className="mt-1 text-[9px] text-[#77766d]">When practice shows a mistake, it will be saved here automatically.</p></div>:<div className="mt-4 grid gap-3 lg:grid-cols-2">{open.map(item=><article key={item.id} className="rounded-xl border border-black/15 p-4"><div className="text-[9px] font-bold text-[#72741e]">{item.subject}</div><h2 className="mt-1 text-[11px] font-bold leading-5">{item.question}</h2><p className="mt-3 rounded-lg bg-[#a24127]/5 p-3 text-[9px] leading-5"><span className="font-bold">Your answer: </span>{item.answer}</p><p className="mt-2 rounded-lg bg-[#e6edb0]/45 p-3 text-[9px] leading-5"><span className="font-bold">Review: </span>{item.evaluation}</p><button disabled={busy===item.id} onClick={()=>void review(item.id)} className="black-button focus-ring mt-3 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[9px] font-bold disabled:opacity-50">{busy===item.id?<LoaderCircle className="animate-spin" size={12}/>:<Check size={12}/>} Mark reviewed</button></article>)}</div>}</section>
    {done.length>0&&<section className="rounded-2xl border border-black/20 bg-[#fffef8] p-5"><h2 className="text-[11px] font-black">Reviewed ({done.length})</h2><div className="mt-3 space-y-2">{done.map(item=><details key={item.id} className="rounded-lg border border-black/10 px-3 py-2"><summary className="cursor-pointer text-[10px] font-semibold">{item.subject} · {item.question}</summary><p className="mt-2 text-[9px] leading-5 text-[#66655d]">{item.evaluation}</p></details>)}</div></section>}</>}
  </main></div></div>;
}
