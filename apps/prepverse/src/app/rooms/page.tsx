"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Copy, LoaderCircle, MessageCircle, Plus, Send, ShieldCheck, ShieldQuestion, UsersRound, X } from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { ApiError, apiRequest } from "@/lib/api";

type Room = {
  id: string;
  name: string;
  subject: string;
  invite_code: string;
  share_path: string;
  invite_active: boolean;
  invite_expires_at: string | null;
  approval_required: boolean;
  members: number;
  capacity: number;
  is_owner: boolean;
  pending_requests: number;
};
type ChatMessage = { id: string; username: string; body: string; created_at: string };
type JoinRequest = { id: string; username: string; requested_at: string };
type InvitePolicy = { approval_required: boolean; expires_in_hours: number };
const LIVE_UPDATE_INTERVAL_MS = 15_000;
const expiryOptions = [
  { label: "24 hours", value: 24 },
  { label: "7 days", value: 168 },
  { label: "30 days", value: 720 },
];

export default function StudyRoomsPage() {
  const router = useRouter();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [active, setActive] = useState<Room | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [invite, setInvite] = useState("");
  const [draft, setDraft] = useState("");
  const [approvalRequired, setApprovalRequired] = useState(true);
  const [expiresInHours, setExpiresInHours] = useState(168);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<ChatMessage[]>([]);

  function replaceMessages(next: ChatMessage[]) {
    messagesRef.current = next;
    setMessages(next);
  }

  function mergeMessages(incoming: ChatMessage[]) {
    const current = messagesRef.current;
    const knownIds = new Set(current.map((message) => message.id));
    const additions = incoming.filter((message) => !knownIds.has(message.id));
    if (!additions.length) return;
    const merged = [...current, ...additions]
      .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id))
      .slice(-100);
    messagesRef.current = merged;
    setMessages(merged);
  }

  const loadRooms = useCallback(async () => {
    const result = await apiRequest<{ items: Room[] }>("/rooms");
    setRooms(result.items);
    setActive((current) => current ? result.items.find((room) => room.id === current.id) ?? null : current);
    return result.items;
  }, []);

  const loadJoinRequests = useCallback(async (roomId: string) => {
    const result = await apiRequest<{ items: JoinRequest[] }>(`/rooms/${roomId}/join-requests`);
    setJoinRequests(result.items);
  }, []);

  useEffect(() => {
    void loadRooms().catch((cause: unknown) => {
      if (cause instanceof ApiError && cause.status === 401) router.replace("/login");
      else setError(cause instanceof Error ? cause.message : "Study rooms could not be loaded.");
    });
  }, [loadRooms, router]);

  useEffect(() => {
    if (!active) return;
    let live = true;
    let initialized = false;
    const load = () => {
      if (document.visibilityState === "hidden") return;
      const latest = messagesRef.current.at(-1);
      const query = latest ? `?after=${encodeURIComponent(latest.created_at)}` : "";
      return apiRequest<{ items: ChatMessage[] }>(`/rooms/${active.id}/messages${query}`)
      .then((result) => {
        if (!live) return;
        if (!initialized) {
          initialized = true;
          replaceMessages(result.items);
        } else {
          mergeMessages(result.items);
        }
      })
      .catch((cause: unknown) => { if (live) setError(cause instanceof Error ? cause.message : "Room chat could not be refreshed."); });
    };
    void load();
    const timer = window.setInterval(() => void load(), LIVE_UPDATE_INTERVAL_MS);
    return () => { live = false; window.clearInterval(timer); };
  }, [active?.id]);

  useEffect(() => {
    if (!active?.is_owner) {
      setJoinRequests([]);
      return;
    }
    let live = true;
    const load = () => loadJoinRequests(active.id).catch((cause: unknown) => {
      if (live) setError(cause instanceof Error ? cause.message : "Join requests could not be loaded.");
    });
    void load();
    const timer = window.setInterval(() => void load(), LIVE_UPDATE_INTERVAL_MS);
    return () => { live = false; window.clearInterval(timer); };
  }, [active?.id, active?.is_owner, loadJoinRequests]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  function applyRoomUpdate(updated: Room) {
    setRooms((current) => current.map((room) => room.id === updated.id ? updated : room));
    setActive((current) => current?.id === updated.id ? updated : current);
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await apiRequest<Room>("/rooms", {
        method: "POST",
        body: JSON.stringify({ name, subject, approval_required: approvalRequired, expires_in_hours: expiresInHours }),
      });
      setRooms((current) => [result, ...current]);
      setName(""); setSubject(""); setActive(result); replaceMessages([]);
      setNotice("Study room created. Copy its invite link to share with up to three friends.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Study room could not be created.");
    } finally { setBusy(false); }
  }

  async function join(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await apiRequest<{ joined: boolean; pending_approval?: boolean; room_id: string }>(`/rooms/join/${encodeURIComponent(invite.trim())}`, { method: "POST" });
      setInvite("");
      if (result.pending_approval) {
        setNotice("Request sent. The room host must approve it before you can enter.");
      } else {
        const updatedRooms = await loadRooms();
        const joinedRoom = updatedRooms.find((room) => room.id === result.room_id);
        if (joinedRoom) { setActive(joinedRoom); replaceMessages([]); }
        setNotice("You joined the study room.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The invite could not be joined.");
    } finally { setBusy(false); }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!active || !draft.trim()) return;
    setBusy(true); setError("");
    try {
      const result = await apiRequest<ChatMessage>(`/rooms/${active.id}/messages`, { method: "POST", body: JSON.stringify({ body: draft }) });
      mergeMessages([result]); setDraft("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Message could not be sent.");
    } finally { setBusy(false); }
  }

  async function copyRoom(room: Room) {
    if (!room.invite_active || !room.share_path) {
      setNotice("This invite is expired or revoked. The host can replace it with a new link.");
      return;
    }
    const shareUrl = new URL(room.share_path, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(shareUrl);
      setNotice(`Invite link copied. It expires ${room.invite_expires_at ? new Date(room.invite_expires_at).toLocaleString() : "soon"}.`);
    } catch { setNotice(shareUrl); }
  }

  async function replaceInvite(room: Room) {
    setBusy(true); setError(""); setNotice("");
    try {
      const policy: InvitePolicy = { approval_required: room.approval_required, expires_in_hours: 168 };
      const updated = await apiRequest<Room>(`/rooms/${room.id}/invite/rotate`, { method: "POST", body: JSON.stringify(policy) });
      applyRoomUpdate(updated);
      setNotice("A new 7-day invite was created. The previous link is now invalid.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The invite could not be replaced."); }
    finally { setBusy(false); }
  }

  async function revokeInvite(room: Room) {
    setBusy(true); setError(""); setNotice("");
    try {
      const updated = await apiRequest<Room>(`/rooms/${room.id}/invite/revoke`, { method: "POST" });
      applyRoomUpdate(updated);
      setNotice("The invite link has been revoked. No one can use it to request entry.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The invite could not be revoked."); }
    finally { setBusy(false); }
  }

  async function decideRequest(requestId: string, decision: "approve" | "reject") {
    if (!active) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await apiRequest(`/rooms/${active.id}/join-requests/${requestId}`, { method: "POST", body: JSON.stringify({ decision }) });
      await Promise.all([loadRooms(), loadJoinRequests(active.id)]);
      setNotice(decision === "approve" ? "Learner approved and added to the room." : "Join request declined.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The join request could not be updated."); }
    finally { setBusy(false); }
  }

  return <div className="site-frame app-frame min-h-[calc(100vh-60px)]"><div className="lg:flex"><AppSidebar active="/rooms"/><main className="min-w-0 flex-1 bg-[#f6f4eb] px-4 py-5 sm:px-7 sm:py-7 lg:px-9">
    <header className="mb-6"><div className="text-[9px] font-bold uppercase tracking-[.16em] text-[#777823]">STUDY ALONGSIDE FRIENDS</div><h1 className="display-type mt-1 text-4xl leading-none sm:text-5xl">Study Rooms</h1><p className="mt-2 text-[11px] text-[#66655d]">Create a room, control who joins, and study with up to three friends.</p></header>
    {error && <p role="alert" className="mb-4 rounded-xl border border-[#a24127]/30 bg-[#a24127]/5 p-3 text-[10px] text-[#842d18]">{error}</p>}
    {notice && <p role="status" className="mb-4 break-all rounded-xl border border-black/15 bg-white/70 p-3 text-[10px]">{notice}</p>}
    <div className="grid gap-4 xl:grid-cols-[.8fr_1.2fr]">
      <section className="space-y-4">
        <form onSubmit={create} className="rounded-2xl border-2 border-black bg-[#fffef8] p-5 shadow-[3px_3px_0_#10100f]">
          <div className="flex items-center gap-2 text-[12px] font-black"><Plus size={16}/>Create a room</div>
          <label className="mt-4 block text-[9px] font-semibold">Room name<input required minLength={2} maxLength={90} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Exam prep group" className="focus-ring mt-1 h-10 w-full rounded-lg border border-black/20 bg-transparent px-3 text-[10px] font-normal"/></label>
          <label className="mt-3 block text-[9px] font-semibold">Study subject<input required maxLength={140} value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="What are you studying together?" className="focus-ring mt-1 h-10 w-full rounded-lg border border-black/20 bg-transparent px-3 text-[10px] font-normal"/></label>
          <label className="mt-3 block text-[9px] font-semibold">Invite link expires after<select value={expiresInHours} onChange={(event) => setExpiresInHours(Number(event.target.value))} className="focus-ring mt-1 h-10 w-full rounded-lg border border-black/20 bg-[#fffef8] px-3 text-[10px] font-normal">{expiryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label className="mt-3 flex cursor-pointer items-start gap-2 text-[9px] leading-4"><input type="checkbox" checked={approvalRequired} onChange={(event) => setApprovalRequired(event.target.checked)} className="mt-0.5 accent-black"/><span><span className="font-semibold">Require host approval</span><span className="block text-[#77766d]">Recommended. Friends request access before joining.</span></span></label>
          <button disabled={busy} className="black-button focus-ring mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg text-[10px] font-bold disabled:opacity-50">{busy ? <LoaderCircle className="animate-spin" size={13}/> : <UsersRound size={13}/>}Create private study room</button>
        </form>

        <form onSubmit={join} className="rounded-2xl border border-black/20 bg-[#fffef8] p-5"><h2 className="text-[11px] font-black">Join a friend&apos;s room</h2><p className="mt-1 text-[9px] text-[#77766d]">Open their invite link, or enter the invite code.</p><div className="mt-3 flex gap-2"><input required value={invite} onChange={(event) => setInvite(event.target.value)} placeholder="Invite code" className="focus-ring h-10 min-w-0 flex-1 rounded-lg border border-black/20 bg-transparent px-3 text-[10px]"/><button disabled={busy} className="acid-button focus-ring flex h-10 items-center gap-2 rounded-lg px-3 text-[9px] font-bold">Join <ArrowRight size={12}/></button></div></form>

        <section className="rounded-2xl border border-black/20 bg-[#fffef8] p-5"><h2 className="text-[11px] font-black">Your rooms</h2>{rooms.length === 0 ? <p className="mt-3 text-[9px] leading-5 text-[#77766d]">You have not created or joined a room yet.</p> : <div className="mt-3 space-y-2">{rooms.map((room) => <article key={room.id} className={`rounded-xl border p-3 ${active?.id === room.id ? "border-black bg-[#efff4f]" : "border-black/15"}`}>
          <button className="w-full text-left" onClick={() => { setActive(room); replaceMessages([]); }}><div className="text-[10px] font-bold">{room.name}</div><div className="mt-1 text-[8px] text-[#69685f]">{room.subject} · {room.members}/{room.capacity} people · {room.approval_required ? "host approval" : "instant entry"}</div>{room.is_owner && room.pending_requests > 0 && <div className="mt-1 text-[8px] font-bold">{room.pending_requests} request{room.pending_requests === 1 ? "" : "s"} waiting</div>}</button>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">{room.invite_active && <button onClick={() => void copyRoom(room)} className="focus-ring inline-flex items-center gap-1 text-[8px] font-bold underline underline-offset-2"><Copy size={10}/>Copy invite</button>}{room.is_owner && <><button disabled={busy} onClick={() => void replaceInvite(room)} className="focus-ring text-[8px] font-bold underline underline-offset-2 disabled:opacity-50">Replace link</button>{room.invite_active && <button disabled={busy} onClick={() => void revokeInvite(room)} className="focus-ring text-[8px] font-semibold text-[#842d18] underline underline-offset-2 disabled:opacity-50">Revoke</button>}</>}</div>
          <div className="mt-1 text-[8px] text-[#77766d]">{room.invite_active && room.invite_expires_at ? `Invite expires ${new Date(room.invite_expires_at).toLocaleString()}` : "No active invite link"}</div>
        </article>)}</div>}</section>

        {active?.is_owner && <section className="rounded-2xl border border-black/20 bg-[#fffef8] p-5"><div className="flex items-center justify-between gap-2"><h2 className="text-[11px] font-black">Join requests</h2><span className="rounded-md bg-[#f3f1e7] px-2 py-1 text-[8px] font-bold">{joinRequests.length} pending</span></div>{joinRequests.length === 0 ? <p className="mt-3 text-[9px] text-[#77766d]">No one is waiting for approval.</p> : <div className="mt-3 space-y-2">{joinRequests.map((request) => <article key={request.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-black/10 p-3"><div className="min-w-0 flex-1"><div className="text-[9px] font-bold">{request.username}</div><div className="mt-1 text-[8px] text-[#77766d]">Requested {new Date(request.requested_at).toLocaleString()}</div></div><button disabled={busy} onClick={() => void decideRequest(request.id, "approve")} aria-label={`Approve ${request.username}`} className="focus-ring inline-flex items-center gap-1 rounded-md bg-[#efff4f] px-2 py-1.5 text-[8px] font-bold disabled:opacity-50"><Check size={11}/>Approve</button><button disabled={busy} onClick={() => void decideRequest(request.id, "reject")} aria-label={`Decline ${request.username}`} className="focus-ring inline-flex items-center gap-1 rounded-md border border-black/15 px-2 py-1.5 text-[8px] font-bold disabled:opacity-50"><X size={11}/>Decline</button></article>)}</div>}</section>}
      </section>

      <section className="flex min-h-[520px] flex-col overflow-hidden rounded-2xl border border-black/20 bg-[#10100f] text-[#f2f0e5]">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 p-4"><div className="flex items-center gap-2"><span className="flex size-8 items-center justify-center rounded-lg bg-[#efff4f] text-black"><MessageCircle size={15}/></span><div><h2 className="text-[11px] font-black">{active?.name ?? "Room study chat"}</h2><p className="mt-1 text-[8px] text-white/50">{active ? `${active.subject} · ${active.members} of ${active.capacity} members` : "Choose a room or create one to begin."}</p></div></div>{active && <button onClick={() => void copyRoom(active)} disabled={!active.invite_active} className="focus-ring inline-flex items-center gap-1 rounded-lg border border-white/20 px-3 py-2 text-[8px] font-semibold disabled:opacity-40"><Copy size={11}/>Invite</button>}</header>
        {!active ? <div className="grid flex-1 place-items-center p-6 text-center"><div><UsersRound className="mx-auto text-[#efff4f]" size={28}/><p className="mt-3 text-[11px] font-bold">A shared study space for your group</p><p className="mt-1 max-w-xs text-[9px] leading-5 text-white/50">Create a room or join using a friend&apos;s invite link. Room chat is visible to approved members.</p></div></div> : <>
          {active.approval_required && !active.is_owner && <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2 text-[8px] text-white/55"><ShieldQuestion size={12}/>Invite access is controlled by the room host.</div>}
          {active.is_owner && <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2 text-[8px] text-white/55"><ShieldCheck size={12}/>{active.approval_required ? "New members need your approval." : "Invite holders can join without approval."}</div>}
          <div className="flex-1 space-y-3 overflow-y-auto p-4">{messages.length === 0 ? <div className="py-8 text-center text-[9px] text-white/45">No messages yet. Say hello to your group.</div> : messages.map((message) => <article key={message.id} className="rounded-lg border border-white/10 bg-white/5 p-3"><div className="flex justify-between gap-3 text-[8px]"><span className="font-bold text-[#efff4f]">{message.username}</span><time className="text-white/35">{new Date(message.created_at).toLocaleTimeString()}</time></div><p className="mt-1 whitespace-pre-wrap text-[10px] leading-5">{message.body}</p></article>)}<div ref={endRef}/></div>
          <form onSubmit={send} className="flex gap-2 border-t border-white/10 p-3"><input maxLength={2000} required value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Message the room…" className="focus-ring h-10 min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-3 text-[10px] text-white placeholder:text-white/40"/><button disabled={busy} className="focus-ring flex size-10 items-center justify-center rounded-lg bg-[#efff4f] text-black disabled:opacity-50" aria-label="Send message"><Send size={14}/></button></form>
        </>}
      </section>
    </div>
  </main></div></div>;
}
