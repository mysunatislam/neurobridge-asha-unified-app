"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Panel } from "@/components/dashboard/Panel";
import { Switch } from "@/components/dashboard/Switch";
import { Button } from "@/components/ui/Button";
import { SendIcon, VolumeIcon } from "@/components/ui/icons";
import { askAsha, type ChatReply, type ChatTurn } from "@/features/assistant/askAsha";
import { loadLocalModel, LOCAL_MODEL_LABEL, useLocalModel } from "@/features/assistant/localModel";
import { usePerception } from "@/features/perception/PerceptionProvider";
import { useRequests } from "@/features/requests/RequestProvider";
import { sessionStore, useSession } from "@/features/session/store";
import { speak } from "@/features/speech/speak";
import { cn } from "@/lib/cn";

type Message = ChatTurn & { reply?: ChatReply };

export default function AssistantPage() {
  const cred = useSession((s) => s.patient);
  const settings = useSession((s) => s.settings);
  const { snapshot, state } = usePerception();
  const { propose } = useRequests();
  const local = useLocalModel();
  // Restart the on-device model after a reload when it was switched on before (cached download).
  useEffect(() => {
    if (settings.deviceAI) loadLocalModel().catch(() => {});
  }, [settings.deviceAI]);
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", text: "Hi, I’m Asha. Ask me anything about the app, or tell me what you need." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  // Another module (e.g. Nutrition's "Ask ASHA about this meal") can prefill a question.
  // It is only placed in the box; nothing is sent until the person presses Send.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) setInput(q.slice(0, 600));
  }, []);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    await ask(input.trim());
  }

  async function ask(text: string, cloud = settings.cloud) {
    if (!text || busy) return;
    setInput("");
    const history = messages.slice(-6).map(({ role, text }) => ({ role, text }));
    setMessages((m) => [...m, { role: "user", text }]);
    setBusy(true);
    try {
      const reply = await askAsha(cred, {
        text,
        cloud,
        deviceAI: settings.deviceAI,
        history,
        language: settings.language,
        context: `Camera ${state === "on" ? "on" : "off"}; posture ${snapshot.posture?.label ?? "unavailable"}`,
      });
      setMessages((m) => [...m, { role: "assistant", text: reply.reply, reply }]);
      if (reply.reply) speak(reply.reply);
    } catch (err) {
      setMessages((m) => [...m, { role: "assistant", text: (err as Error).message }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Talk to Asha" description="Short, friendly answers. Asha can suggest a request, but you always confirm it." />
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <Panel bodyClassName="flex h-[min(68vh,640px)] flex-col p-0">
          <div className="flex-1 space-y-4 overflow-y-auto p-5" aria-live="polite">
            {messages.map((m, i) => (
              <div key={i} className={cn("flex gap-3", m.role === "user" && "justify-end")}>
                {m.role === "assistant" && <Image src="/assets/assets/images/asha-avatar.png" alt="" width={32} height={32} className="size-8 shrink-0 rounded-full" />}
                <div className={cn("max-w-[80%] rounded-2xl px-4 py-3", m.role === "user" ? "rounded-br-md bg-brand text-white" : "rounded-bl-md bg-wash text-ink")}>
                  <p>{m.text}</p>
                  {m.reply?.proposal && (
                    <Button size="sm" className="mt-3" onClick={() => propose(m.reply!.proposal!.kind, m.reply!.proposal!.text, "asha")}>
                      Ask caregiver: {m.reply.proposal.text}
                    </Button>
                  )}
                  {m.reply?.suggestedModule && (
                    <Link href={`/dashboard/patient/${m.reply.suggestedModule}`} className="mt-2 block text-sm font-medium text-brand">
                      Open {m.reply.suggestedModule}
                    </Link>
                  )}
                  {m.reply?.notice && <p className="mt-2 text-xs text-muted" data-testid="reply-notice">{m.reply.notice}</p>}
                  {m.reply?.offerCloud && !settings.cloud && (
                    <button
                      onClick={() => {
                        sessionStore.updateSettings({ cloud: true });
                        const asked = messages[i - 1];
                        if (asked?.role === "user") void ask(asked.text, true);
                      }}
                      className="mt-1 block text-sm font-medium text-brand hover:underline"
                    >
                      Turn on cloud assistance and ask again
                    </button>
                  )}
                  {m.role === "assistant" && i > 0 && (
                    <button onClick={() => speak(m.text)} className="mt-2 flex items-center gap-1 text-xs text-muted hover:text-ink" aria-label="Speak this reply">
                      <VolumeIcon size={14} /> Speak
                    </button>
                  )}
                </div>
              </div>
            ))}
            {busy && <p className="text-sm text-muted">Asha is thinking…</p>}
            <div ref={end} />
          </div>
          <form onSubmit={send} className="flex gap-2 border-t border-line p-3">
            <label htmlFor="chat" className="sr-only">
              Message Asha
            </label>
            <input
              id="chat"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={600}
              placeholder="Type to Asha"
              className="h-12 flex-1 rounded-xl border border-line px-4 focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
            />
            <Button type="submit" className="h-12 w-12 px-0" aria-label="Send" disabled={busy}>
              <SendIcon size={18} />
            </Button>
          </form>
        </Panel>
        <Panel title="Privacy">
          <Switch
            checked={settings.cloud}
            onChange={(cloud) => sessionStore.updateSettings({ cloud })}
            label="Cloud assistance"
            description="Your words and capability assessment are sent to Asha’s AI service. Camera video never is."
          />
          <div className="mt-5 border-t border-line pt-5">
            <Switch
              checked={!!settings.deviceAI}
              onChange={(deviceAI) => {
                sessionStore.updateSettings({ deviceAI });
                if (deviceAI) loadLocalModel().catch(() => {});
              }}
              label="On-device AI (experimental)"
              description={`${LOCAL_MODEL_LABEL}. Downloads about 400 MB once, then runs in this browser; your words never leave the device. Needs desktop Chrome or Edge.`}
            />
            {settings.deviceAI && local.state !== "off" && (
              <div className="mt-3 text-xs text-muted" role="status" data-testid="device-ai-status">
                {local.state === "loading" && (
                  <div className="mb-1.5 h-1.5 overflow-hidden rounded-full bg-wash">
                    <div className="h-full bg-brand" style={{ width: `${Math.round(local.progress * 100)}%` }} />
                  </div>
                )}
                {local.text}
              </div>
            )}
          </div>
        </Panel>
      </div>
    </>
  );
}
