import { api, ApiError, type Credential } from "@/lib/api";
import { readLocal } from "@/lib/storage";
import { guideAnswer } from "@/lib/guide-answer.js";
import { urgentCompanionResponse } from "../../../public/app/everyday/companion-safety.js";

export type ChatTurn = { role: "user" | "assistant"; text: string };

export type ChatReply = {
  reply: string;
  language?: string;
  proposal?: { kind: string; text: string };
  suggestedModule?: string;
  safety?: { level: string };
  /** "guide" when the answer came from Asha's own guide, "device" from the on-device model. */
  answeredBy?: "guide" | "model" | "device";
  /** One quiet line explaining a guide answer. */
  notice?: string;
  /** Offer to turn on cloud assistance (shown only when it is off). */
  offerCloud?: boolean;
};

export type InterpretReply = {
  candidate: string;
  alternatives: string[];
  question: string;
  language?: string;
  safety?: { level: string };
  answeredBy?: "guide" | "model" | "device";
  notice?: string;
  offerCloud?: boolean;
};

type SpeechPair = { heard: string; confirmedText: string; confirmed: boolean };

export function confirmedSpeechPairs(patientId: string) {
  return readLocal<SpeechPair[]>("speech_" + patientId, [])
    .filter(
      (x) =>
        x?.confirmed === true && x.heard?.trim() && x.confirmedText?.trim(),
    )
    .slice(-20);
}

/** Sends a message to Asha (server-side model orchestration). Requires cloud consent. */
export async function askAsha(
  cred: Credential | null,
  body: {
    text: string;
    cloud: boolean;
    mode?: "chat" | "interpret";
    module?: string;
    context?: string;
    history?: ChatTurn[];
    language?: string;
    deviceAI?: boolean;
  },
) {
  // The existing precautionary response runs locally, including before linking or cloud consent.
  const urgent = urgentCompanionResponse(body.text, {
    language: body.language,
    mode: body.mode ?? "chat",
  });
  if (urgent)
    return {
      reply: "",
      candidate: "",
      alternatives: [],
      question: "",
      ...urgent,
    } as ChatReply & InterpretReply;
  const local = (notice: string, offerCloud = false) => {
    const guide = guideAnswer({ query: body.text, module: body.module, language: body.language });
    return {
      reply: guide.reply,
      candidate: body.text.slice(0, 250),
      alternatives: [],
      question:
        body.mode === "interpret"
          ? offerCloud
            ? "Cloud assistance is off, so Asha kept your words as heard. Is this what you said?"
            : "Asha's AI could not be reached, so your words are kept as heard. Is this what you said?"
          : "",
      answeredBy: "guide" as const,
      notice,
      offerCloud,
    } as ChatReply & InterpretReply;
  };
  // On-device AI (chat only): a small model in this browser, grounded in the guide.
  if (body.deviceAI && (body.mode ?? "chat") === "chat") {
    try {
      const { localReply } = await import("./localModel");
      const lang = body.language === "bn" || /[\u0980-\u09ff]/u.test(body.text) ? "bn" : "en";
      const guide = guideAnswer({ query: body.text, module: body.module, language: lang });
      const reply = await localReply({ text: body.text, language: lang, evidence: guide.reply, history: body.history ?? [] });
      return {
        reply,
        candidate: "",
        alternatives: [],
        question: "",
        answeredBy: "device" as const,
        notice: "Answered by the on-device model. Nothing left this device. To ask your caregiver for something, use Ask for help.",
      } as ChatReply & InterpretReply;
    } catch {
      // Fall through to the cloud (if allowed) or the guide.
    }
  }
  // Without consent nothing leaves the device: Asha answers from its own guide.
  if (!body.cloud)
    return local("Answered on this device from Asha's guide. Turn on cloud assistance for AI replies.", true);
  try {
    return await api<ChatReply & InterpretReply>("asha", {
      cred,
      body: {
        consent: true,
        // The on-device demo has no care circle: ask as a guest, with no stored profile.
        ...(cred ? {} : { guest: true }),
        mode: body.mode ?? "chat",
        module: body.module ?? "companion",
        context: body.context ?? "",
        history: body.history?.slice(-6) ?? [],
        language: body.language ?? "auto",
        text: body.text,
        confirmedMemories:
          cred && body.mode === "interpret" ? confirmedSpeechPairs(cred.patientId) : [],
      },
    });
  } catch (error) {
    // Rate limits and rejected sign-ins are worth saying as they are.
    if (error instanceof ApiError && (error.status === 429 || error.status === 401 || error.status === 403)) throw error;
    return local("Asha's AI could not be reached, so this answer is from Asha's guide on this device.");
  }
}
