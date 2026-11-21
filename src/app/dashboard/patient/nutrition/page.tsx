"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Switch } from "@/components/dashboard/Switch";
import { Button } from "@/components/ui/Button";
import { CameraIcon, NutritionIcon } from "@/components/ui/icons";
import { usePerception } from "@/features/perception/PerceptionProvider";
import { DISHES, FOOD_VISION, visionLabel } from "@/features/nutrition/catalog.js";
import { estimateMeal, formatValue } from "@/features/nutrition/engine.js";
import { checkDimensions, checkFile, errorText, fitWithin } from "@/features/nutrition/image.js";
import { answer as answerItem, applicable, back as backItem, describeAnswer, newItem, nextQuestion, progress as itemProgress, reopen } from "@/features/nutrition/interview.js";
import { QuestionCard } from "@/features/nutrition/QuestionCard";
import { Assumptions, ItemCard, MealSummary } from "@/features/nutrition/Results";
import { recognisedFrom, StabilityTracker, suggestionsFrom } from "@/features/nutrition/scan.js";
import { NutritionFlow } from "@/features/nutrition/state.js";
import { nutritionStore, useNutrition, type MealLog } from "@/features/nutrition/store";
import type { Answer, Capture, Item, Meal, Question, Suggestion, Text, VisionResult } from "@/features/nutrition/types";
import { useFoodVision } from "@/features/nutrition/useFoodVision";
import { WeekChart } from "@/features/nutrition/WeekChart";
import { cn } from "@/lib/cn";

type Screen = string;
type Method = Capture["method"];
type Recognised = { label: string; score: number; dishId: string | null };
const L = (lang: string, x?: Text | null) => (x ? (lang === "bn" ? x.bn : x.en) : "");
const tx = (lang: string, en: string, bn: string) => (lang === "bn" ? bn : en);
const fmt = formatValue as (v: unknown, key: string, lang: string) => string;
const DISH = DISHES as Record<string, { id: string; category: string; en: string; bn: string }>;
const ADDABLE = ["rice", "dal", "fish_curry", "banana", "mango", "orange", "guava", "apple", "pear", "peach", "pomegranate", "tomato", "strawberries", "packaged", "other"];
const SCANNING = ["SCANNING", "QUALITY_WAIT", "CANDIDATE_STABLE"];

const QUALITY_TEXT: Record<string, Text> = {
  face: { en: "A face is in view. Point the camera at the food only.", bn: "ক্যামেরায় মুখ দেখা যাচ্ছে। শুধু খাবারের দিকে ধরুন।" },
  low_light: { en: "Too dark. Move to better light.", bn: "খুব অন্ধকার। আলোতে যান।" },
  overexposed: { en: "Too bright. Avoid strong light on the plate.", bn: "খুব উজ্জ্বল। প্লেটে কড়া আলো এড়িয়ে চলুন।" },
  low_detail_or_blur: { en: "Hold the phone steady. The picture is blurry.", bn: "ফোন স্থির রাখুন। ছবি ঝাপসা।" },
  low_resolution: { en: "Move a little closer.", bn: "একটু কাছে আনুন।" },
};

function canvasToUrl(canvas: HTMLCanvasElement) {
  return new Promise<string>((resolve) => canvas.toBlob((b) => resolve(b ? URL.createObjectURL(b) : canvas.toDataURL("image/jpeg", 0.85)), "image/jpeg", 0.85));
}

export default function NutritionPage() {
  const lang = useNutrition((s) => s.language);
  const autoFreeze = useNutrition((s) => s.autoFreeze);
  const log = useNutrition((s) => s.log);
  const perception = usePerception();
  const vision = useFoodVision();

  const [screen, setScreen] = useState<Screen>("IDLE");
  const flow = useRef<NutritionFlow | null>(null);
  flow.current ??= new NutritionFlow((to: string) => setScreen(to));
  const go = useCallback((to: string) => flow.current!.go(to), []);

  const [method, setMethod] = useState<Method>("manual");
  const [items, setItems] = useState<Item[]>([]);
  const [focus, setFocus] = useState<{ uid: string; qid: string; previous?: Answer; from: "review" | "back" } | null>(null);
  const [eaten, setEaten] = useState<Record<string, string>>({});
  const [photo, setPhoto] = useState<string | null>(null);
  const [still, setStill] = useState<{ suggestions: Suggestion[]; recognised?: Recognised[]; vision: VisionResult | null } | null>(null);
  const [error, setError] = useState<string>("");
  const [notice, setNotice] = useState<string>("");
  const [scanInfo, setScanInfo] = useState<{ tentative: string | null; warnings: string[]; face: boolean; steady: boolean }>({ tentative: null, warnings: [], face: false, steady: false });
  const [slow, setSlow] = useState(false);
  const [armed, setArmed] = useState(true);
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [loggedId, setLoggedId] = useState<string | null>(null);
  // A double tap on "Log this meal" must not also press the button that appears in its place.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    setSettled(false);
    if (screen !== "LOGGED") return;
    const t = setTimeout(() => setSettled(true), 800);
    return () => clearTimeout(t);
  }, [screen]);

  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const tracker = useRef(new StabilityTracker());
  const epoch = useRef(0);
  const busy = useRef(false);
  const timeouts = useRef(0);
  const baseCanvas = useRef<HTMLCanvasElement | null>(null);
  const workCanvas = useRef<HTMLCanvasElement | null>(null);
  const mealId = useRef<string>("");
  const pausedShared = useRef(false);
  const perceptionRef = useRef(perception);
  perceptionRef.current = perception;
  const armedRef = useRef(armed);
  armedRef.current = armed;

  const setLang = (l: "en" | "bn") => nutritionStore.set({ language: l });
  const live = useRef<HTMLParagraphElement>(null);

  // ---- camera ---------------------------------------------------------------------------------
  const stopCamera = useCallback((restoreShared = true) => {
    epoch.current++;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    // Give the shared camera back once Nutrition no longer needs its own (not while in the background).
    if (restoreShared && pausedShared.current) {
      pausedShared.current = false;
      void perceptionRef.current.start();
    }
  }, []);

  const openCamera = useCallback(async () => {
    // One camera at a time: the shared camera (front, for requests) pauses while scanning food.
    if (perceptionRef.current.state === "on") {
      perceptionRef.current.stop();
      pausedShared.current = true;
    }
    const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    stream.current = s;
    const v = video.current;
    if (v) {
      v.srcObject = s;
      await v.play().catch(() => {});
    }
  }, []);

  // The viewfinder mounts after the camera opens; hand it the stream when it appears.
  useEffect(() => {
    const v = video.current;
    if (!v || !stream.current || !SCANNING.includes(screen)) return;
    if (v.srcObject !== stream.current) v.srcObject = stream.current;
    if (v.paused) void v.play().catch(() => {});
  }, [screen]);

  const resetPhoto = useCallback(() => {
    setPhoto((u) => {
      if (u?.startsWith("blob:")) URL.revokeObjectURL(u);
      return null;
    });
    setStill(null);
  }, []);

  const reset = useCallback(() => {
    stopCamera();
    resetPhoto();
    setItems([]);
    setEaten({});
    setFocus(null);
    setError("");
    setNotice("");
    setLoggedId(null);
    baseCanvas.current = workCanvas.current = null;
    go("IDLE");
  }, [go, resetPhoto, stopCamera]);

  // Release the camera and the worker on exit; give the shared camera back if Nutrition paused it.
  useEffect(
    () => () => {
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
      if (pausedShared.current) void perceptionRef.current.start();
    },
    [],
  );
  useEffect(() => {
    const hidden = () => {
      if (!document.hidden || !stream.current) return;
      stopCamera(false);
      if (SCANNING.includes(flow.current!.state)) {
        go("MODE_SELECTED");
        setNotice(tx(lang, "Scanning stopped while ASHA was in the background. Start again when you're ready.", "আশা পেছনে থাকায় স্ক্যান থেমেছে। প্রস্তুত হলে আবার শুরু করুন।"));
      }
    };
    document.addEventListener("visibilitychange", hidden);
    const gone = () => stopCamera(false);
    window.addEventListener("pagehide", gone);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", gone);
    };
  }, [go, lang, stopCamera]);

  // ---- the shared still-image pipeline (upload, manual shutter and auto freeze) ---------------
  const analyzeStill = useCallback(
    async (canvas: HTMLCanvasElement) => {
      const r = await vision.classify(canvas, canvas.width, canvas.height, 20000);
      const ok = !(r.unavailable || r.timeout || r.error);
      const suggestions = ok ? (suggestionsFrom(r.categories) as Suggestion[]) : [];
      const recognised = ok ? (recognisedFrom(r.categories) as Recognised[]) : [];
      setStill({ suggestions, recognised, vision: r });
      return { suggestions, vision: r };
    },
    [vision.classify],
  );

  const toItems = (suggestions: Suggestion[], vr: VisionResult | null, m: Method): Item[] => {
    const flags = [...(vr?.quality?.warnings ?? []), ...((vr?.faceCount ?? 0) > 0 ? ["face_in_photo"] : [])];
    return suggestions.map((s) => newItem(s.dishId, { method: m, modelId: s.modelId, modelVersion: s.modelVersion, suggestion: { label: s.label, score: s.score }, qualityFlags: flags }) as Item);
  };

  // ---- live scan --------------------------------------------------------------------------------
  const startLive = async () => {
    if (flow.current!.state !== "RETRY") reset();
    go("MODE_SELECTED");
    setMethod("live_scan");
    setError("");
    setNotice("");
    vision.load();
    try {
      await openCamera();
    } catch (err) {
      const name = (err as DOMException)?.name;
      if (name === "NotAllowedError" || name === "SecurityError") go("PERMISSION_DENIED");
      else {
        setError(name === "NotFoundError" ? tx(lang, "No camera was found on this device.", "এই ডিভাইসে ক্যামেরা পাওয়া যায়নি।") : tx(lang, "The camera couldn't start. Another app may be using it.", "ক্যামেরা চালু হয়নি। অন্য কোনো অ্যাপ হয়তো ব্যবহার করছে।"));
        go("ERROR");
      }
      return;
    }
    tracker.current.reset();
    timeouts.current = 0;
    setSlow(false);
    setArmed(autoFreeze);
    setScanInfo({ tentative: null, warnings: [], face: false, steady: false });
    go("SCANNING");
  };

  const freeze = useCallback(async () => {
    const f = flow.current!;
    if (!SCANNING.includes(f.state)) return; // no duplicate captures
    const v = video.current;
    if (!v || v.readyState < 2 || !v.videoWidth) return;
    const size = fitWithin(v.videoWidth, v.videoHeight);
    const c = Object.assign(document.createElement("canvas"), size);
    c.getContext("2d")!.drawImage(v, 0, 0, size.width, size.height);
    if (!go("SNAPSHOT_FROZEN")) return;
    epoch.current++; // results still in flight are dropped
    v.pause();
    workCanvas.current = c;
    setPhoto(await canvasToUrl(c));
    await analyzeStill(c);
  }, [analyzeStill, go]);

  // Sample a few frames per second in the worker while scanning. Nothing runs once frozen.
  useEffect(() => {
    if (!SCANNING.includes(screen) || vision.status !== "ready") return;
    const id = setInterval(async () => {
      const v = video.current;
      if (busy.current || !v || v.readyState < 2 || !v.videoWidth || !flow.current!.inferring) return;
      busy.current = true;
      const my = epoch.current;
      const r = await vision.classify(v, v.videoWidth, v.videoHeight, 3000);
      busy.current = false;
      if (my !== epoch.current || !flow.current!.inferring) return;
      if (r.timeout) {
        timeouts.current += 1;
        if (timeouts.current >= 2) setSlow(true);
        return;
      }
      if (r.error || r.unavailable) return;
      const out = tracker.current.push({ categories: r.categories, quality: r.quality, faceInView: (r.faceCount ?? 0) > 0 });
      setScanInfo({ tentative: out.tentative, warnings: out.warnings ?? [], face: !!out.faceInView, steady: out.state === "CANDIDATE_STABLE" });
      const now = flow.current!.state;
      if (out.state === "QUALITY_WAIT" && now === "SCANNING") go("QUALITY_WAIT");
      if (out.state === "SCANNING" && now === "QUALITY_WAIT") go("SCANNING");
      if (out.state === "CANDIDATE_STABLE") {
        if (armedRef.current) {
          go("CANDIDATE_STABLE");
          void freeze();
        } else tracker.current.reset(); // manual shutter: keep showing hints, never freeze by itself
      }
    }, 400);
    return () => clearInterval(id);
  }, [screen, vision.status, vision.classify, freeze, go]);

  const rescan = async (rearm: boolean) => {
    resetPhoto();
    workCanvas.current = null;
    tracker.current.reset();
    epoch.current++;
    setArmed(rearm && autoFreeze);
    setScanInfo({ tentative: null, warnings: [], face: false, steady: false });
    setNotice("");
    if (!go("SCANNING")) return;
    if (!stream.current?.active) {
      try {
        await openCamera();
      } catch {
        go("PERMISSION_DENIED");
        return;
      }
    } else await video.current?.play().catch(() => {});
    if (!rearm) setNotice(tx(lang, "Automatic freeze is off for this try. Tap Capture when the whole plate is in the square.", "এবার নিজে থেকে থামবে না। পুরো প্লেট বর্গের ভেতরে এলে ছবি তুলুন চাপুন।"));
  };

  // ---- upload -----------------------------------------------------------------------------------
  const startUpload = () => {
    if (flow.current!.state !== "RETRY") reset();
    go("MODE_SELECTED");
    setMethod("upload");
    setError("");
    vision.load();
    fileInput.current?.click();
  };

  const renderWork = useCallback(async () => {
    const base = baseCanvas.current;
    if (!base) return;
    const quarter = ((rotation % 360) + 360) % 360;
    const rw = quarter % 180 ? base.height : base.width, rh = quarter % 180 ? base.width : base.height;
    const rot = Object.assign(document.createElement("canvas"), { width: rw, height: rh });
    const rc = rot.getContext("2d")!;
    rc.translate(rw / 2, rh / 2);
    rc.rotate((quarter * Math.PI) / 180);
    rc.drawImage(base, -base.width / 2, -base.height / 2);
    const cw = Math.round(rw / zoom), ch = Math.round(rh / zoom);
    const out = Object.assign(document.createElement("canvas"), { width: cw, height: ch });
    out.getContext("2d")!.drawImage(rot, (rw - cw) / 2, (rh - ch) / 2, cw, ch, 0, 0, cw, ch);
    workCanvas.current = out;
    const url = await canvasToUrl(out);
    setPhoto((u) => {
      if (u?.startsWith("blob:")) URL.revokeObjectURL(u);
      return url;
    });
  }, [rotation, zoom]);

  useEffect(() => {
    if (screen === "IMAGE_VALIDATED") void renderWork();
  }, [screen, renderWork]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (!go("IMAGE_SELECTED")) return;
    const fail = (code: string) => {
      setError(errorText(code, lang));
      go("ERROR");
    };
    const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    const c = checkFile({ bytes: head, size: file.size });
    if (!c.ok) return fail(c.code!);
    let bmp: ImageBitmap;
    try {
      // Applies the EXIF rotation; the canvas copy below carries no metadata.
      bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      return fail(c.type === "image/heic" ? "heic_unsupported" : "decode_failed");
    }
    const d = checkDimensions(bmp.width, bmp.height);
    if (!d.ok) {
      bmp.close();
      return fail(d.code!);
    }
    const size = fitWithin(bmp.width, bmp.height);
    const canvas = Object.assign(document.createElement("canvas"), size);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, size.width, size.height);
    bmp.close();
    baseCanvas.current = canvas;
    setRotation(0);
    setZoom(1);
    go("IMAGE_VALIDATED");
  };

  const acceptPhoto = async () => {
    const c = workCanvas.current;
    if (!c || !go("ANALYZING")) return;
    const r = await analyzeStill(c);
    mealId.current = crypto.randomUUID();
    setItems(toItems(r.suggestions, r.vision, "upload"));
    go("FOOD_REVIEW");
  };

  // ---- review, questions, result ----------------------------------------------------------------
  const confirmStill = () => {
    if (!go("FOOD_REVIEW")) return;
    stopCamera();
    mealId.current = crypto.randomUUID();
    setItems(toItems(still?.suggestions ?? [], still?.vision ?? null, "live_scan"));
  };

  const manual = () => {
    stopCamera();
    if (flow.current!.state === "IDLE") go("MODE_SELECTED");
    if (!go("MANUAL")) return;
    if (!photo) setMethod("manual");
    mealId.current = crypto.randomUUID();
    go("FOOD_REVIEW");
  };

  const pending = useMemo(() => items.map((it) => ({ it, q: nextQuestion(it) as Question | null })).filter((x) => x.q), [items]);
  const current = focus ? items.find((i) => i.uid === focus.uid) : pending[0]?.it;
  const currentQ: Question | null = focus && current ? ((applicable(current) as Question[]).find((q) => q.id === focus.qid) ?? null) : (pending[0]?.q ?? null);
  const totals = items.reduce((acc, it) => {
    const p = itemProgress(it);
    return { done: acc.done + p.done, total: acc.total + p.total };
  }, { done: 0, total: 0 });

  const onAnswer = (a: Answer) => {
    if (!current || !currentQ) return;
    let next: Item;
    try {
      next = answerItem(current, currentQ.id, a) as Item;
    } catch {
      return;
    }
    const all = items.map((i) => (i.uid === current.uid ? next : i));
    setItems(all);
    setFocus(null);
    if (all.every((i) => !nextQuestion(i))) go("INGREDIENT_REVIEW");
  };

  const onBack = () => {
    if (!current) return;
    if (focus?.from === "review") {
      // Leave the question unchanged and go back to the review.
      const prev = focus.previous;
      setItems(items.map((i) => (i.uid === focus.uid && prev ? { ...i, answers: { ...i.answers, [focus.qid]: prev }, history: [...i.history, focus.qid] } : i)));
      setFocus(null);
      return void go("INGREDIENT_REVIEW");
    }
    const idx = items.findIndex((i) => i.uid === current.uid);
    let target = current;
    if (!(current.history ?? []).length) {
      const prev = [...items.slice(0, idx)].reverse().find((i) => (i.history ?? []).length);
      if (!prev) return void go("FOOD_REVIEW");
      target = prev;
    }
    const r = backItem(target) as { item: Item; question: Question | null; previous?: Answer };
    setItems(items.map((i) => (i.uid === target.uid ? r.item : i)));
    if (r.question) setFocus({ uid: target.uid, qid: r.question.id, previous: r.previous, from: "back" });
  };

  const change = (uid: string, qid: string) => {
    const it = items.find((i) => i.uid === uid);
    if (!it || !go("QUESTIONNAIRE")) return;
    const r = reopen(it, qid) as { item: Item; previous?: Answer };
    setItems(items.map((i) => (i.uid === uid ? r.item : i)));
    setFocus({ uid, qid, previous: r.previous, from: "review" });
  };

  const meal = useMemo(() => (items.length ? (estimateMeal(items, eaten) as Meal) : null), [items, eaten]);

  const calculate = () => {
    if (!go("CALCULATING")) return;
    setItems((all) => all.map((i) => ({ ...i, calculated: true })));
    go("RESULT");
  };

  const logMeal = () => {
    if (!meal) return;
    const r = flow.current!.logOnce(() => {
      const byUid = Object.fromEntries(items.map((i) => [i.uid, i]));
      const entry: MealLog = {
        id: mealId.current || crypto.randomUUID(),
        loggedAt: new Date().toISOString(),
        captureMethod: method,
        status: meal.status,
        total: meal.total,
        eaten: meal.eaten,
        excluded: meal.excluded,
        items: meal.items.map((x) => ({
          uid: x.uid,
          dishId: x.dishId,
          label: x.label,
          status: x.status,
          eaten: eaten[x.uid] ?? null,
          nutrients: x.nutrients,
          canonical: x.canonical,
          answers: byUid[x.uid]?.answers ?? {},
          sources: x.components.flatMap((c) => c.sources.map((s) => ({ databaseRecordId: s.databaseRecordId, databaseSource: s.databaseSource, dataVersion: s.dataVersion, verification: s.verification }))),
        })),
        dataVersion: meal.dataVersion,
        engineVersion: meal.engineVersion,
        model: items.some((i) => i.capture?.modelId) ? { id: FOOD_VISION.modelId, version: FOOD_VISION.modelVersion } : null,
        photoStored: false,
      };
      nutritionStore.addLog(entry);
      return entry.id;
    });
    if (r.id) {
      setLoggedId(r.id);
      stopCamera();
    }
  };

  const discard = () => {
    if (!go("DISCARDED")) return;
    stopCamera();
    resetPhoto();
    setItems([]);
    setEaten({});
  };

  const askHref = useMemo(() => {
    if (!meal) return "/dashboard/patient/assistant";
    const parts = meal.items.map((r) => `${L(lang, r.label)}: ${r.status === "uncertain" || r.status === "unavailable" ? tx(lang, "no estimate", "অনুমান নেই") : fmt(r.nutrients.kcal, "kcal", lang)}`);
    const q = tx(lang, `About my meal (ASHA's estimate from food tables): ${parts.join("; ")}. Can you explain this estimate and what would change it?`, `আমার খাবার নিয়ে (খাদ্য তালিকা থেকে আশার অনুমান): ${parts.join("; ")}। এই অনুমানটি বুঝিয়ে বলবেন, আর কী বদলালে এটি বদলাবে?`);
    return `/dashboard/patient/assistant?q=${encodeURIComponent(q.slice(0, 600))}`;
  }, [meal, lang]);

  // Announce screen changes to screen readers.
  const announce = useMemo(() => {
    const map: Record<string, Text> = {
      SCANNING: { en: "Camera on. Point it at the food inside the square.", bn: "ক্যামেরা চালু। বর্গের ভেতরে খাবারের দিকে ধরুন।" },
      SNAPSHOT_FROZEN: { en: "Photo taken. Check what ASHA saw.", bn: "ছবি তোলা হয়েছে। আশা কী দেখেছে দেখুন।" },
      FOOD_REVIEW: { en: "Check the foods on your plate.", bn: "আপনার প্লেটের খাবারগুলো দেখুন।" },
      RESULT: { en: "Your estimate is ready.", bn: "আপনার অনুমান তৈরি।" },
      LOGGED: { en: "Meal saved on this device.", bn: "খাবার এই ডিভাইসে সংরক্ষিত।" },
    };
    return L(lang, map[screen]);
  }, [screen, lang]);

  const scanMessage = (() => {
    if (vision.status === "loading") return tx(lang, "Loading the on-device food model (about 20 MB the first time)…", "ডিভাইসের খাবার মডেল লোড হচ্ছে (প্রথমবার প্রায় ২০ MB)…");
    if (vision.status === "error") return tx(lang, "Food suggestions aren't available on this device. You can still take a photo and choose the foods yourself.", "এই ডিভাইসে খাবারের পরামর্শ পাওয়া যাচ্ছে না। তবু ছবি তুলে নিজে খাবার বাছতে পারেন।");
    if (scanInfo.face) return L(lang, QUALITY_TEXT.face);
    const w = scanInfo.warnings.find((x) => QUALITY_TEXT[x]);
    if (w) return L(lang, QUALITY_TEXT[w]);
    if (slow) return tx(lang, "Suggestions are slow on this phone. Tap Capture whenever you're ready.", "এই ফোনে পরামর্শ ধীরে আসছে। প্রস্তুত হলে ছবি তুলুন চাপুন।");
    if (scanInfo.tentative) return armed ? tx(lang, `Possible: ${visionLabel(scanInfo.tentative, lang)} (experimental). Hold steady…`, `সম্ভবত: ${visionLabel(scanInfo.tentative, lang)} (পরীক্ষামূলক)। স্থির রাখুন…`) : tx(lang, `Possible: ${visionLabel(scanInfo.tentative, lang)} (experimental). Tap Capture when the whole plate is in the square.`, `সম্ভবত: ${visionLabel(scanInfo.tentative, lang)} (পরীক্ষামূলক)। পুরো প্লেট বর্গে এলে ছবি তুলুন চাপুন।`);
    return tx(lang, "Point the camera at the food, inside the square. Keep people out of the picture.", "বর্গের ভেতরে খাবারের দিকে ক্যামেরা ধরুন। ছবিতে মানুষ রাখবেন না।");
  })();

  // ---- views ------------------------------------------------------------------------------------
  const header = (
    <PageHeader
      title={tx(lang, "Nutrition", "পুষ্টি")}
      description={tx(lang, "Log what you ate and see an estimate, with where every number comes from.", "কী খেয়েছেন লিখুন, আর প্রতিটি সংখ্যার উৎসসহ অনুমান দেখুন।")}
      actions={
        <div className="flex rounded-full bg-wash p-1" role="group" aria-label="Language / ভাষা">
          {(["en", "bn"] as const).map((l) => (
            <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)} className={cn("min-h-9 rounded-full px-3 text-sm font-medium", lang === l ? "bg-white text-ink shadow" : "text-muted")} lang={l}>
              {l === "en" ? "English" : "বাংলা"}
            </button>
          ))}
        </div>
      }
    />
  );

  const showCamera = SCANNING.includes(screen) || screen === "SNAPSHOT_FROZEN";

  return (
    <div lang={lang === "bn" ? "bn" : "en"} data-testid="nutrition-page" data-screen={screen} className="pb-10">
      {header}
      <p ref={live} className="sr-only" aria-live="polite">
        {announce}
      </p>
      <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" className="sr-only" tabIndex={-1} aria-hidden="true" data-testid="nutrition-file" onChange={(e) => {
        void onFile(e.target.files?.[0]);
        e.target.value = "";
      }} />

      {(screen === "IDLE" || screen === "MODE_SELECTED") && (
        <div className="space-y-6">
          {notice && <p className="rounded-xl bg-amber-50 px-4 py-3 text-amber-900 ring-1 ring-amber-200">{notice}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <button type="button" onClick={() => void startLive()} className="flex min-h-36 flex-col items-start gap-3 rounded-2xl bg-brand p-5 text-left text-white shadow-sm focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/40" data-testid="nutrition-scan">
              <CameraIcon size={28} />
              <span className="text-xl font-semibold">{tx(lang, "Scan food live", "লাইভ স্ক্যান")}</span>
              <span className="text-white/85">{tx(lang, "Point your camera at the plate. ASHA takes the photo when it's steady.", "প্লেটের দিকে ক্যামেরা ধরুন। স্থির হলে আশা ছবি তোলে।")}</span>
            </button>
            <button type="button" onClick={startUpload} className="flex min-h-36 flex-col items-start gap-3 rounded-2xl bg-white p-5 text-left ring-1 ring-line shadow-sm hover:bg-wash focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/40" data-testid="nutrition-upload">
              <NutritionIcon size={28} className="text-brand" />
              <span className="text-xl font-semibold text-ink">{tx(lang, "Upload a photo", "ছবি আপলোড")}</span>
              <span className="text-muted">{tx(lang, "Choose a photo of your meal from the gallery.", "গ্যালারি থেকে খাবারের ছবি বাছুন।")}</span>
            </button>
          </div>
          <Button variant="secondary" onClick={manual} data-testid="nutrition-manual">
            {tx(lang, "Enter food without a photo", "ছবি ছাড়া খাবার লিখুন")}
          </Button>
          <div className="rounded-2xl bg-wash p-4 text-sm text-muted">
            <p className="font-medium text-ink">{tx(lang, "Good to know", "জেনে রাখুন")}</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>{tx(lang, "The camera recognises 65 foods, including 31 Bangladeshi dishes, with an on-device model trained on public food photos (right about 4 times in 5 on our Bangladeshi test photos; not yet tested on volunteers' own meals). It fills in a food only when it has USDA numbers for it and is sure enough (rice, dal, fish curry, banana, apple, pear, peach, pomegranate, raw tomato, strawberries); for anything else it names the food and you choose. Always check it.", "ক্যামেরা ডিভাইসের ভেতরের একটি মডেলে ৩১টি বাংলাদেশি পদসহ ৬৫টি খাবার চেনে, যা প্রকাশ্য খাবারের ছবিতে প্রশিক্ষিত (আমাদের বাংলাদেশি পরীক্ষার ছবিতে প্রায় প্রতি ৫টিতে ৪টি ঠিক; স্বেচ্ছাসেবকদের নিজের খাবারে এখনো পরীক্ষা হয়নি)। এটি কেবল USDA-র মান আছে এবং যথেষ্ট নিশ্চিত হলে খাবার নিজে বসায় (ভাত, ডাল, মাছের ঝোল, কলা, আপেল, নাশপাতি, পীচ, ডালিম, কাঁচা টমেটো, স্ট্রবেরি); অন্য খাবারের নাম বলে, বাছবেন আপনি। সবসময় যাচাই করুন।")}</li>
              <li>{tx(lang, "Photos are looked at on this device only and are never saved or sent.", "ছবি কেবল এই ডিভাইসে দেখা হয়, কখনো সংরক্ষণ বা পাঠানো হয় না।")}</li>
              <li>{tx(lang, "Numbers are estimates from food tables (USDA), not measurements. ASHA shows what it assumed.", "সংখ্যাগুলো খাদ্য তালিকার (USDA) অনুমান, মাপ নয়। আশা কী ধরে নিয়েছে তা দেখায়।")}</li>
            </ul>
          </div>
          <MealHistory log={log} lang={lang} />
        </div>
      )}

      {showCamera && (
        <div className="mx-auto max-w-xl space-y-4">
          <div className="relative mx-auto aspect-square w-full max-w-[min(100%,70vh)] overflow-hidden rounded-2xl bg-heading" data-testid="nutrition-viewfinder">
            <video ref={video} muted playsInline className={cn("absolute inset-0 size-full object-cover", screen === "SNAPSHOT_FROZEN" && photo && "invisible")} aria-label={tx(lang, "Camera view", "ক্যামেরার দৃশ্য")} />
            {screen === "SNAPSHOT_FROZEN" && photo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo} alt={tx(lang, "The photo ASHA took", "আশার তোলা ছবি")} className="absolute inset-0 size-full object-cover" />
            )}
            <div aria-hidden="true" className={cn("pointer-events-none absolute left-[10%] top-[10%] size-[80%] rounded-2xl border-4", scanInfo.tentative ? "border-emerald-300" : "border-white/80", screen === "SNAPSHOT_FROZEN" && "border-white")} />
            {scanInfo.tentative && SCANNING.includes(screen) && (
              <span className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-white/95 px-3 py-1 text-sm font-medium text-ink" data-testid="nutrition-tentative">
                {tx(lang, "Possible: ", "সম্ভবত: ")}
                {visionLabel(scanInfo.tentative, lang)} · {tx(lang, "experimental", "পরীক্ষামূলক")}
              </span>
            )}
          </div>

          {SCANNING.includes(screen) && (
            <>
              <p className="min-h-12 text-center text-lg font-medium text-ink" aria-live="polite" data-testid="nutrition-scan-message">
                {notice || scanMessage}
              </p>
              <div className="flex justify-center">
                <button type="button" onClick={() => void freeze()} className="grid size-20 place-items-center rounded-full bg-brand text-white shadow-lg ring-4 ring-brand-soft focus:outline-none focus-visible:ring-brand/50" aria-label={tx(lang, "Capture photo now", "এখনই ছবি তুলুন")} data-testid="nutrition-shutter">
                  <CameraIcon size={30} />
                </button>
              </div>
              <div className="rounded-2xl bg-white px-4 ring-1 ring-line">
                <Switch checked={autoFreeze} onChange={(v) => {
                  nutritionStore.set({ autoFreeze: v });
                  setArmed(v);
                  setNotice("");
                }} label={tx(lang, "Take the photo by itself when the food is steady", "খাবার স্থির হলে নিজে থেকেই ছবি তুলুক")} description={tx(lang, "Off: only the Capture button takes the photo.", "বন্ধ: শুধু ছবি তুলুন বোতাম ছবি তোলে।")} />
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="secondary" onClick={manual}>
                  {tx(lang, "Enter food without a photo", "ছবি ছাড়া খাবার লিখুন")}
                </Button>
                <Button variant="ghost" onClick={reset}>
                  {tx(lang, "Cancel", "বাতিল")}
                </Button>
              </div>
            </>
          )}

          {screen === "SNAPSHOT_FROZEN" && (
            <div className="space-y-3" data-testid="nutrition-frozen">
              <StillFindings still={still} lang={lang} />
              <div className="grid gap-2 sm:grid-cols-2">
                <Button onClick={confirmStill} disabled={!still} data-testid="nutrition-confirm">
                  {tx(lang, "Confirm and continue", "নিশ্চিত করে এগোন")}
                </Button>
                <Button variant="secondary" onClick={() => void rescan(true)} data-testid="nutrition-retake">
                  {tx(lang, "Retake", "আবার তুলুন")}
                </Button>
                <Button variant="ghost" onClick={() => void rescan(false)} data-testid="nutrition-continue">
                  {tx(lang, "Continue scanning", "স্ক্যান চালিয়ে যান")}
                </Button>
                <Button variant="ghost" onClick={manual}>
                  {tx(lang, "Manual entry", "নিজে লিখুন")}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {(screen === "IMAGE_SELECTED" || screen === "IMAGE_VALIDATED" || screen === "ANALYZING") && (
        <div className="mx-auto max-w-xl space-y-4" data-testid="nutrition-preview">
          <div className="relative grid min-h-64 place-items-center overflow-hidden rounded-2xl bg-wash ring-1 ring-line">
            {photo && screen !== "IMAGE_SELECTED" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo} alt={tx(lang, "Your photo", "আপনার ছবি")} className="max-h-[60vh] w-auto object-contain" />
            ) : (
              <p className="p-6 text-muted">{tx(lang, "Checking the photo…", "ছবি যাচাই হচ্ছে…")}</p>
            )}
          </div>
          {screen === "IMAGE_VALIDATED" && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => setRotation((r) => r - 90)}>
                  {tx(lang, "Rotate left", "বামে ঘোরান")}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setRotation((r) => r + 90)}>
                  {tx(lang, "Rotate right", "ডানে ঘোরান")}
                </Button>
                <label className="flex items-center gap-2 text-sm text-ink">
                  {tx(lang, "Crop to the centre", "মাঝখানে কাটুন")}
                  <input type="range" min={1} max={3} step={0.25} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-valuetext={`${zoom}×`} className="w-32" />
                </label>
              </div>
              <p className="text-sm text-muted">{tx(lang, "Photo details such as location and time were removed. This copy stays on this device.", "অবস্থান ও সময়ের মতো ছবির তথ্য সরানো হয়েছে। এই কপি এই ডিভাইসেই থাকে।")}</p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void acceptPhoto()} data-testid="nutrition-use-photo">
                  {tx(lang, "Use this photo", "এই ছবি ব্যবহার করুন")}
                </Button>
                <Button variant="secondary" onClick={() => {
                  if (go("IMAGE_SELECTED")) go("MODE_SELECTED");
                  fileInput.current?.click();
                }}>
                  {tx(lang, "Choose another photo", "অন্য ছবি বাছুন")}
                </Button>
                <Button variant="ghost" onClick={reset}>
                  {tx(lang, "Cancel", "বাতিল")}
                </Button>
              </div>
            </>
          )}
          {screen === "ANALYZING" && (
            <p className="text-center text-lg text-ink" aria-live="polite">
              {tx(lang, "Looking at the photo on this device…", "এই ডিভাইসে ছবি দেখা হচ্ছে…")}
            </p>
          )}
        </div>
      )}

      {(screen === "ERROR" || screen === "PERMISSION_DENIED") && (
        <div className="mx-auto max-w-xl space-y-4 rounded-2xl bg-white p-5 ring-1 ring-line" role="alert" data-testid="nutrition-error">
          <h2 className="text-lg font-semibold text-ink">{screen === "PERMISSION_DENIED" ? tx(lang, "Camera permission is off", "ক্যামেরার অনুমতি বন্ধ") : tx(lang, "Something didn't work", "কিছু একটা কাজ করেনি")}</h2>
          <p className="text-muted">{screen === "PERMISSION_DENIED" ? tx(lang, "ASHA can't use the camera. You can allow it in your browser's site settings, upload a photo instead, or enter the food without a photo.", "আশা ক্যামেরা ব্যবহার করতে পারছে না। ব্রাউজারের সাইট সেটিংসে অনুমতি দিন, ছবি আপলোড করুন, বা ছবি ছাড়া খাবার লিখুন।") : error}</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => {
              go("RETRY");
              if (method === "upload") startUpload();
              else void startLive();
            }}>
              {tx(lang, "Try again", "আবার চেষ্টা করুন")}
            </Button>
            {screen === "PERMISSION_DENIED" && (
              <Button variant="secondary" onClick={() => {
                go("RETRY");
                startUpload();
              }}>
                {tx(lang, "Upload a photo instead", "বরং ছবি আপলোড করুন")}
              </Button>
            )}
            <Button variant="secondary" onClick={manual} data-testid="nutrition-error-manual">
              {tx(lang, "Enter food without a photo", "ছবি ছাড়া খাবার লিখুন")}
            </Button>
          </div>
        </div>
      )}

      {screen === "FOOD_REVIEW" && (
        <FoodReview
          lang={lang}
          photo={photo}
          still={still}
          items={items}
          method={method}
          onRemove={(uid) => setItems((all) => all.filter((i) => i.uid !== uid))}
          onAdd={(dishId) => setItems((all) => [...all, newItem(dishId, { method: method === "manual" ? "manual" : method }) as Item])}
          onNext={() => {
            if (!items.length) return;
            setFocus(null);
            if (!go("QUESTIONNAIRE")) return;
            if (items.every((i) => !nextQuestion(i))) go("INGREDIENT_REVIEW");
          }}
          onRetake={method === "live_scan" ? () => void rescan(true) : method === "upload" ? () => {
            if (go("IMAGE_SELECTED")) go("MODE_SELECTED");
            fileInput.current?.click();
          } : undefined}
          onDiscard={discard}
        />
      )}

      {screen === "QUESTIONNAIRE" && current && currentQ && (
        <div className="mx-auto max-w-2xl">
          <QuestionCard
            key={`${current.uid}:${currentQ.id}`}
            question={currentQ}
            lang={lang}
            previous={focus?.qid === currentQ.id ? focus.previous : undefined}
            onAnswer={onAnswer}
            onBack={onBack}
            canBack
            heading={tx(lang, `Food ${items.findIndex((i) => i.uid === current.uid) + 1} of ${items.length}: ${L(lang, DISH[current.dishId])}`, `${items.length}টির ${items.findIndex((i) => i.uid === current.uid) + 1} নম্বর খাবার: ${L(lang, DISH[current.dishId])}`)}
            progress={totals}
          />
        </div>
      )}

      {(screen === "INGREDIENT_REVIEW" || screen === "EDIT_ANSWERS") && (
        <div className="mx-auto max-w-2xl space-y-4" data-testid="nutrition-review">
          <h2 className="text-xl font-semibold text-ink">{screen === "EDIT_ANSWERS" ? tx(lang, "Improve the estimate", "অনুমান আরও ঠিক করুন") : tx(lang, "Check your answers", "উত্তরগুলো দেখুন")}</h2>
          <p className="text-muted">{tx(lang, "Change anything that isn't right. Each food is counted once.", "যা ঠিক নয় বদলান। প্রতিটি খাবার একবারই গোনা হয়।")}</p>
          {items.map((it) => (
            <section key={it.uid} className="rounded-2xl bg-white p-4 ring-1 ring-line" data-testid="review-item" data-dish={it.dishId}>
              <h3 className="font-semibold text-ink">{L(lang, DISH[it.dishId])}</h3>
              <dl className="mt-2 divide-y divide-line">
                {(applicable(it) as Question[]).map((q) => (
                  <div key={q.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <dt className="text-sm text-muted">{L(lang, q.text)}</dt>
                    <dd className="flex items-center gap-2">
                      <span className="font-medium text-ink">{describeAnswer(q, it.answers[q.id], lang) || tx(lang, "Not answered", "উত্তর নেই")}</span>
                      <Button size="sm" variant="ghost" onClick={() => change(it.uid, q.id)} aria-label={`${tx(lang, "Change", "বদলান")}: ${L(lang, q.text)}`}>
                        {tx(lang, "Change", "বদলান")}
                      </Button>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button onClick={calculate} data-testid="nutrition-calculate">
              {screen === "EDIT_ANSWERS" ? tx(lang, "Recalculate", "আবার হিসাব করুন") : tx(lang, "See my estimate", "অনুমান দেখুন")}
            </Button>
            <Button variant="secondary" onClick={() => go("FOOD_REVIEW")}>
              {tx(lang, "Add or remove foods", "খাবার যোগ বা বাদ দিন")}
            </Button>
          </div>
        </div>
      )}

      {(screen === "RESULT" || screen === "LOGGED") && meal && (
        <div className="mx-auto max-w-3xl space-y-4" data-testid="nutrition-result">
          {photo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt={tx(lang, "Your meal photo", "আপনার খাবারের ছবি")} className="max-h-56 w-full rounded-2xl object-cover" />
          )}
          <ul className="flex flex-wrap gap-2" aria-label={tx(lang, "Foods", "খাবার")}>
            {items.map((i) => (
              <li key={i.uid} className="rounded-full bg-brand-soft px-3 py-1 text-sm font-medium text-brand">
                {L(lang, DISH[i.dishId])}
                {i.capture?.suggestion ? ` · ${tx(lang, "camera suggestion, confirmed by you", "ক্যামেরার পরামর্শ, আপনি নিশ্চিত করেছেন")}` : ""}
              </li>
            ))}
          </ul>
          <MealSummary meal={meal} lang={lang} />
          {screen === "RESULT" && meal.counted.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => setEaten(Object.fromEntries(meal.counted.map((u) => [u, "all"])))} data-testid="nutrition-ate-all">
                {tx(lang, "I ate all of it", "পুরোটা খেয়েছি")}
              </Button>
              <span className="text-sm text-muted">{tx(lang, "or choose for each food below.", "বা নিচে প্রতিটি খাবারের জন্য বাছুন।")}</span>
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            {meal.items.map((r) => (
              <ItemCard key={r.uid} r={r} lang={lang} eaten={eaten[r.uid] ?? null} onEaten={screen === "RESULT" ? (c) => setEaten((e) => ({ ...e, [r.uid]: c })) : undefined} />
            ))}
          </div>
          <Assumptions meal={meal} lang={lang} />
          {screen === "RESULT" ? (
            <div className="sticky bottom-0 -mx-4 flex flex-wrap gap-2 border-t border-line bg-white/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
              <Button onClick={logMeal} disabled={meal.counted.length > 0 && !meal.eaten} data-testid="nutrition-log">
                {tx(lang, "Log this meal", "খাবারটি লিখে রাখুন")}
              </Button>
              <Button variant="secondary" onClick={() => go("EDIT_ANSWERS")} data-testid="nutrition-improve">
                {tx(lang, "Improve estimate", "অনুমান ঠিক করুন")}
              </Button>
              <Link href={askHref} className="inline-flex h-11 items-center rounded-full px-5 font-medium text-brand hover:bg-wash" data-testid="nutrition-ask">
                {tx(lang, "Ask ASHA about this meal", "এই খাবার নিয়ে আশাকে জিজ্ঞেস করুন")}
              </Link>
              <Button variant="ghost" onClick={discard} data-testid="nutrition-discard">
                {tx(lang, "Discard", "বাদ দিন")}
              </Button>
              {meal.counted.length > 0 && !meal.eaten && <p className="w-full text-sm text-muted">{tx(lang, "To log it, say how much of each food you ate.", "লিখে রাখতে, প্রতিটি খাবারের কতটা খেয়েছেন জানান।")}</p>}
            </div>
          ) : (
            <div className="rounded-2xl bg-brand-soft p-4 text-brand" role="status" data-testid="nutrition-logged" data-log-id={loggedId ?? ""}>
              <p className="font-semibold">{tx(lang, "Saved on this device. No photo was kept.", "এই ডিভাইসে সংরক্ষিত। কোনো ছবি রাখা হয়নি।")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={reset} disabled={!settled}>
                  {tx(lang, "Log another meal", "আরেকটি খাবার লিখুন")}
                </Button>
                <Link href={askHref} className="inline-flex h-11 items-center rounded-full px-5 font-medium text-brand hover:bg-white">
                  {tx(lang, "Ask ASHA about this meal", "এই খাবার নিয়ে আশাকে জিজ্ঞেস করুন")}
                </Link>
              </div>
            </div>
          )}
        </div>
      )}

      {screen === "DISCARDED" && (
        <div className="mx-auto max-w-xl rounded-2xl bg-white p-5 ring-1 ring-line" role="status" data-testid="nutrition-discarded">
          <p className="font-semibold text-ink">{tx(lang, "Discarded. Nothing was saved.", "বাদ দেওয়া হয়েছে। কিছুই সংরক্ষণ হয়নি।")}</p>
          <Button className="mt-3" onClick={reset}>
            {tx(lang, "Start again", "আবার শুরু করুন")}
          </Button>
        </div>
      )}
    </div>
  );
}

function StillFindings({ still, lang }: { still: { suggestions: Suggestion[]; recognised?: Recognised[]; vision: VisionResult | null } | null; lang: string }) {
  if (!still) return <p className="text-center text-ink" aria-live="polite">{tx(lang, "Looking at the photo…", "ছবি দেখা হচ্ছে…")}</p>;
  const v = still.vision;
  const warn = [...(v?.quality?.warnings ?? []).filter((w) => QUALITY_TEXT[w]).map((w) => L(lang, QUALITY_TEXT[w])), ...((v?.faceCount ?? 0) > 0 ? [tx(lang, "A face is in this photo. It isn't saved, but you may want to retake it with only the food.", "ছবিতে মুখ আছে। এটি সংরক্ষণ হয় না, তবু শুধু খাবার রেখে আবার তুলতে পারেন।")] : [])];
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-line" aria-live="polite" data-testid="nutrition-still-findings">
      {still.suggestions.length ? (
        <p className="text-lg text-ink">
          {tx(lang, "ASHA's camera suggests: ", "আশার ক্যামেরার পরামর্শ: ")}
          <strong>{still.suggestions.map((s) => L(lang, DISH[s.dishId])).join(", ")}</strong>
          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">{tx(lang, "experimental, check it", "পরীক্ষামূলক, যাচাই করুন")}</span>
        </p>
      ) : still.recognised?.length && still.recognised[0].score >= FOOD_VISION.minScore ? (
        <p className="text-lg text-ink" data-testid="nutrition-recognised">
          {tx(lang, "Looks like: ", "দেখে মনে হচ্ছে: ")}
          <strong>{visionLabel(still.recognised[0].label, lang)}</strong>
          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">{tx(lang, "experimental, check it", "পরীক্ষামূলক, যাচাই করুন")}</span>
          <span className="mt-1 block text-sm text-muted">
            {still.recognised[0].dishId
              ? tx(lang, `Not added for you: the camera isn't sure enough about this food. If it's right, tap + ${DISH[still.recognised[0].dishId].en} below.`, `নিজে থেকে যোগ হয়নি: ক্যামেরা এই খাবারে যথেষ্ট নিশ্চিত নয়। ঠিক হলে নিচে + ${DISH[still.recognised[0].dishId].bn} চাপুন।`)
              : tx(lang, "ASHA doesn't have nutrition numbers for this food yet, so it isn't added for you. Choose what you ate below.", "এই খাবারের পুষ্টির হিসাব আশার কাছে এখনো নেই, তাই নিজে থেকে যোগ হয়নি। নিচে যা খেয়েছেন তা বাছুন।")}
          </span>
        </p>
      ) : (
        <p className="text-lg text-ink">{v?.unavailable || v?.timeout || v?.error ? tx(lang, "No camera suggestion this time. You'll choose the foods next.", "এবার ক্যামেরার পরামর্শ নেই। এরপর আপনি খাবার বাছবেন।") : tx(lang, "ASHA's camera didn't recognise a food it knows. You'll choose the foods next.", "আশার ক্যামেরা চেনা কোনো খাবার পায়নি। এরপর আপনি খাবার বাছবেন।")}</p>
      )}
      {warn.map((w) => (
        <p key={w} className="mt-1 text-sm text-amber-900">
          {w}
        </p>
      ))}
    </div>
  );
}

function FoodReview({ lang, photo, still, items, method, onRemove, onAdd, onNext, onRetake, onDiscard }: { lang: string; photo: string | null; still: { suggestions: Suggestion[]; recognised?: Recognised[]; vision: VisionResult | null } | null; items: Item[]; method: Method; onRemove: (uid: string) => void; onAdd: (dishId: string) => void; onNext: () => void; onRetake?: () => void; onDiscard: () => void }) {
  return (
    <div className="mx-auto max-w-2xl space-y-4" data-testid="nutrition-food-review">
      {photo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt={tx(lang, "Your meal photo", "আপনার খাবারের ছবি")} className="max-h-64 w-full rounded-2xl object-cover" />
      )}
      {method !== "manual" && <StillFindings still={still} lang={lang} />}
      <section className="rounded-2xl bg-white p-4 ring-1 ring-line">
        <h2 className="text-lg font-semibold text-ink">{tx(lang, "What's on the plate?", "প্লেটে কী আছে?")}</h2>
        <p className="text-sm text-muted">{tx(lang, "Add each food separately (for example rice, dal and fish curry), so each one is counted once.", "প্রতিটি খাবার আলাদা করে যোগ করুন (যেমন ভাত, ডাল, মাছের ঝোল), যাতে প্রতিটি একবার গোনা হয়।")}</p>
        <ul className="mt-3 space-y-2" data-testid="nutrition-chips">
          {items.map((i) => (
            <li key={i.uid} className="flex min-h-12 items-center justify-between gap-2 rounded-xl bg-wash px-3 py-2" data-dish={i.dishId} data-origin={i.capture?.suggestion ? "camera" : "person"}>
              <span>
                <span className="font-medium text-ink">{L(lang, DISH[i.dishId])}</span>
                <span className="ml-2 text-xs text-muted">{i.capture?.suggestion ? tx(lang, `Camera suggestion (experimental, score ${i.capture.suggestion.score}, not a probability)`, `ক্যামেরার পরামর্শ (পরীক্ষামূলক, স্কোর ${i.capture.suggestion.score}, সম্ভাবনা নয়)`) : tx(lang, "Added by you", "আপনি যোগ করেছেন")}</span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => onRemove(i.uid)} aria-label={`${tx(lang, "Remove", "সরান")} ${L(lang, DISH[i.dishId])}`}>
                {tx(lang, "Remove", "সরান")}
              </Button>
            </li>
          ))}
          {!items.length && <li className="text-muted">{tx(lang, "No foods yet. Add them below.", "এখনো কোনো খাবার নেই। নিচে যোগ করুন।")}</li>}
        </ul>
        <h3 className="mt-4 text-sm font-medium text-ink">{tx(lang, "Add a food", "খাবার যোগ করুন")}</h3>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="nutrition-add">
          {ADDABLE.map((id) => (
            <button key={id} type="button" onClick={() => onAdd(id)} className="min-h-12 rounded-xl bg-white px-3 py-2 text-left font-medium text-ink ring-1 ring-line hover:bg-wash focus:outline-none focus-visible:ring-2 focus-visible:ring-brand" data-dish={id}>
              + {L(lang, DISH[id])}
            </button>
          ))}
        </div>
      </section>
      <div className="flex flex-wrap gap-2">
        <Button onClick={onNext} disabled={!items.length} data-testid="nutrition-foods-ok">
          {tx(lang, "These are right: next", "ঠিক আছে: এগোন")}
        </Button>
        {onRetake && (
          <Button variant="secondary" onClick={onRetake}>
            {method === "live_scan" ? tx(lang, "Retake", "আবার তুলুন") : tx(lang, "Choose another photo", "অন্য ছবি বাছুন")}
          </Button>
        )}
        <Button variant="ghost" onClick={onDiscard}>
          {tx(lang, "Discard", "বাদ দিন")}
        </Button>
      </div>
    </div>
  );
}

function MealHistory({ log, lang }: { log: MealLog[]; lang: string }) {
  const [confirmClear, setConfirmClear] = useState(false);
  const exportLog = () => {
    const blob = new Blob([nutritionStore.export()], { type: "application/json" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `asha-nutrition-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <section aria-labelledby="meal-log" className="rounded-2xl bg-white p-4 ring-1 ring-line" data-testid="nutrition-history">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="meal-log" className="text-lg font-semibold text-ink">
          {tx(lang, "Your meal log (this device)", "আপনার খাবারের তালিকা (এই ডিভাইস)")}
        </h2>
        {log.length > 0 && (
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={exportLog}>
              {tx(lang, "Export", "এক্সপোর্ট")}
            </Button>
            {confirmClear ? (
              <Button size="sm" variant="ghost" className="text-red-700" onClick={() => {
                nutritionStore.clear();
                setConfirmClear(false);
              }}>
                {tx(lang, "Yes, delete all", "হ্যাঁ, সব মুছুন")}
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setConfirmClear(true)}>
                {tx(lang, "Delete all", "সব মুছুন")}
              </Button>
            )}
          </div>
        )}
      </div>
      {log.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{tx(lang, "Nothing logged yet.", "এখনো কিছু লেখা হয়নি।")}</p>
      ) : (
        <>
        <WeekChart log={log} lang={lang} />
        <ul className="mt-3 divide-y divide-line">
          {[...log].reverse().slice(0, 20).map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="nutrition-log-entry">
              <span>
                <span className="block font-medium text-ink">{m.items.map((i) => L(lang, i.label)).join(", ")}</span>
                <span className="text-sm text-muted">
                  {new Date(m.loggedAt).toLocaleString(lang === "bn" ? "bn-BD" : "en-GB", { dateStyle: "medium", timeStyle: "short" })} · {m.eaten ? `${tx(lang, "eaten", "খাওয়া")} ${fmt(m.eaten.kcal, "kcal", lang)}` : tx(lang, "no estimate", "অনুমান নেই")}
                </span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => nutritionStore.removeLog(m.id)} aria-label={`${tx(lang, "Delete", "মুছুন")} ${m.items.map((i) => L(lang, i.label)).join(", ")}`}>
                {tx(lang, "Delete", "মুছুন")}
              </Button>
            </li>
          ))}
        </ul>
        </>
      )}
    </section>
  );
}
