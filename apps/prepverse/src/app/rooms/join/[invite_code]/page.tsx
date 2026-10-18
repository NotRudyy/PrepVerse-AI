"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle, UsersRound } from "lucide-react";
import Link from "next/link";
import { apiRequest } from "@/lib/api";

export default function JoinRoomPage(){
  const params=useParams<{invite_code:string}>();const router=useRouter();const [status,setStatus]=useState("Joining your friend's study room…");const [error,setError]=useState("");const [pending,setPending]=useState(false);
  useEffect(()=>{apiRequest<{room_id:string;pending_approval?:boolean}>(`/rooms/join/${encodeURIComponent(params.invite_code)}`,{method:"POST"}).then(result=>{if(result.pending_approval){setStatus("");setPending(true);return;}router.replace("/rooms");}).catch((cause:unknown)=>{if(cause instanceof Error&&cause.message.includes("Sign in")){router.replace(`/login?next=${encodeURIComponent(`/rooms/join/${params.invite_code}`)}`);return;}setError(cause instanceof Error?cause.message:"This room invite could not be joined.");setStatus("");});},[params.invite_code,router]);
  return <main className="site-frame grid min-h-[calc(100vh-60px)] place-items-center p-6"><section className="max-w-lg rounded-2xl border-2 border-black bg-[#fffef8] p-8 text-center shadow-[5px_5px_0_#10100f]"><span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-[#efff4f]"><UsersRound size={20}/></span><h1 className="display-type mt-4 text-4xl">Study Room Invite</h1>{status&&<p className="mt-3 inline-flex items-center gap-2 text-[10px] text-[#66655d]"><LoaderCircle className="animate-spin" size={13}/>{status}</p>}{pending&&<><p className="mt-3 text-[10px] leading-5 text-[#66655d]">Your request was sent. The host must approve it first. After approval, reopen this same invite link to enter the room.</p><Link href="/rooms" className="black-button focus-ring mt-5 inline-flex h-10 items-center gap-2 rounded-lg px-4 text-[10px] font-bold">Go to Study Rooms <ArrowRight size={13}/></Link></>}{error&&<><p role="alert" className="mt-3 text-[10px] leading-5 text-[#842d18]">{error}</p><Link href="/login" className="black-button focus-ring mt-5 inline-flex h-10 items-center gap-2 rounded-lg px-4 text-[10px] font-bold">Sign in to continue <ArrowRight size={13}/></Link></>}</section></main>;
}
