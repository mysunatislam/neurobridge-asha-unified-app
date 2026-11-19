"use client";

import { useState } from "react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Panel } from "@/components/dashboard/Panel";
import { StatusPill } from "@/components/dashboard/StatusPill";
import { Button } from "@/components/ui/Button";
import { MicIcon } from "@/components/ui/icons";
import { askAsha, type InterpretReply } from "@/features/assistant/askAsha";
import { useActiveModule } from "@/features/perception/PerceptionProvider";
import { useRequests } from "@/features/requests/RequestProvider";
import { sessionStore, useSession } from "@/features/session/store";
import { speak } from "@/features/speech/speak";
import { useSpeechCapture } from "@/features/speech/useSpeechCapture";
import { readLocal, saveLocal } from "@/lib/storage";

const LANGS = [
  { value: "en-US", label: "English" },
  { value: "bn-BD", label: "বাংলা" },
];

export default function SenseAssistPage() {
  useActiveModule("senseassist");
  const cred = useSession((s) => s.patient);
  const settings = useSession((s) => s.settings);
  const { propose } = useRequests();
  const speech = useSpeechCapture();
  const [lang, setLang] = useState(settings.speechLanguage || "en-US");
  const [context, setContext] = useState("");
  const [result, setResult] = useState<InterpretReply | null>(null);
  const [chosen, setChosen] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function clarify() {
    const heard = speech.text.trim();
    if (!heard) return;
    setError("");
    speech.stop();
    setBusy(true);
    try {
      const r = await askAsha(cred, { text: heard, cloud: settings.cloud, mode: "interpret", module: "senseassist", context, language: settings.language });
      setResult(r);
      setChosen(r.candidate);
      speak(r.question);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function confirmMeaning() {
    if (result?.safety?.level === "emergency") return;
    speak(chosen);
    const key = "speech_" + (cred?.patientId ?? "local-demo");
    const memory = readLocal<unknown[]>(key, []);
    saveLocal(key, [...memory, { heard: speech.text.trim(), confirmedText: chosen, confirmed: true }].slice(-30));
  }

  return (
    <>
      <PageHeader title="SenseAssist" description="Speak, check what was heard, and let Asha suggest what you meant. You confirm before anything is spoken or sent." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="1. Speak" description="Listening runs for up to 90 seconds and pauses while Asha talks.">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              className="h-14 px-6 text-lg"
              variant={speech.listening ? "secondary" : "primary"}
              onClick={() => (speech.listening ? speech.stop() : speech.start(lang))}
              disabled={!speech.supported}
            >
              <MicIcon size={20} />
              {speech.listening ? "Stop listening" : "Start listening"}
            </Button>
            <select value={lang} onChange={(e) => setLang(e.target.value)} className="h-11 rounded-xl border border-line bg-white px-3" aria-label="Speech language">
              {LANGS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
            {speech.listening && (
              <StatusPill tone="alert" pulse>
                Listening
              </StatusPill>
            )}
          </div>
          {!speech.supported && <p className="mt-3 text-sm text-muted">This browser can’t transcribe speech. Type what was said instead.</p>}
          {speech.note && <p className="mt-3 text-sm text-muted">{speech.note}</p>}
          <label htmlFor="heard" className="mt-5 block text-sm font-medium text-ink">
            What was heard (you can edit it)
          </label>
          <textarea
            id="heard"
            rows={4}
            value={speech.text}
            onChange={(e) => speech.setText(e.target.value)}
            className="mt-2 w-full rounded-xl border border-line p-3 text-lg focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
          />
          <label htmlFor="ctx" className="mt-3 block text-sm font-medium text-ink">
            Topic (optional)
          </label>
          <input
            id="ctx"
            value={context}
            onChange={(e) => setContext(e.target.value)}
            maxLength={150}
            placeholder="e.g. lunch, family, medicine"
            className="mt-2 h-11 w-full rounded-xl border border-line px-3 focus:border-brand focus:outline-none"
          />
          <Button className="mt-4" onClick={clarify} disabled={!speech.text.trim() || busy}>
            {busy ? "Asha is listening to your meaning…" : "Clarify with Asha"}
          </Button>
          {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        </Panel>

        <Panel title="2. Confirm your meaning">
          {!result ? (
            <p className="py-10 text-center text-sm text-muted">Asha’s suggestion appears here.</p>
          ) : result.safety?.level === "emergency" ? (
            <p className="rounded-xl bg-red-50 p-4 text-lg text-danger" role="alert">{result.question}</p>
          ) : (
            <>
              <p className="text-sm text-muted">{result.question}</p>
              {result.offerCloud && !settings.cloud && (
                <button onClick={() => sessionStore.updateSettings({ cloud: true })} className="text-sm font-medium text-brand hover:underline">
                  Turn on cloud assistance, then press Clarify with Asha again
                </button>
              )}
              <div className="mt-4 space-y-2" role="radiogroup" aria-label="Possible meanings">
                {[result.candidate, ...result.alternatives].map((c) => (
                  <label key={c} className={`flex cursor-pointer items-center gap-3 rounded-xl p-4 ring-1 ${chosen === c ? "bg-brand-soft ring-brand" : "ring-line"}`}>
                    <input type="radio" name="meaning" checked={chosen === c} onChange={() => setChosen(c)} className="accent-brand" />
                    <span className="text-lg text-ink">{c}</span>
                  </label>
                ))}
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button onClick={confirmMeaning}>Yes, speak this</Button>
                <Button variant="secondary" onClick={() => propose("message", chosen, "speech")}>
                  Send to caregiver
                </Button>
                <Button variant="ghost" onClick={() => setResult(null)}>
                  That’s not right
                </Button>
              </div>
            </>
          )}
        </Panel>
      </div>
    </>
  );
}
