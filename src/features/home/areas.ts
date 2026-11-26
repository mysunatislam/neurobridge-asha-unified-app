import { ChatIcon, EyeIcon, HandIcon, HeartIcon, JournalIcon, KeyboardIcon, MicIcon, MoveIcon, NutritionIcon, PostureIcon, ShieldIcon, SparkIcon, TargetIcon } from "@/components/ui/icons";

// One list of what Asha offers, grouped by what the person wants to do. The home chooser, the
// side menu and the area pages all read from here, so a module is defined once.

const P = "/dashboard/patient";

type Icon = (p: { size?: number; className?: string }) => React.ReactElement;
export type Module = { id: string; label: string; text: string; href: string; icon: Icon };
export type AreaId = "communicate" | "talk" | "exercise" | "food" | "wellbeing";
export type Area = { id: AreaId; label: string; text: string; href: string; icon: Icon; modules: Module[] };

export const MODULES: Record<string, Module> = {
  help: { id: "help", label: "Ask for help", text: "Water, food, toilet, comfort or help, confirmed before it is sent", href: `${P}/communicate`, icon: SparkIcon },
  facespeak: { id: "facespeak", label: "FaceSpeak", text: "Blinks, smiles and head movements", href: `${P}/facespeak`, icon: EyeIcon },
  eyespeak: { id: "eyespeak", label: "EyeSpeak", text: "Spell words or pick phrases with your eyes, touch or a switch", href: `${P}/eyespeak`, icon: KeyboardIcon },
  fingerspeak: { id: "fingerspeak", label: "FingerSpeak", text: "Hand and finger gestures", href: `${P}/fingerspeak`, icon: HandIcon },
  senseassist: { id: "senseassist", label: "SenseAssist", text: "Clearer speech with Asha, in Bangla or English", href: `${P}/senseassist`, icon: MicIcon },
  calibration: { id: "calibration", label: "Practise your signals", text: "A short guided session learns how you blink, smile or move", href: `${P}/calibration`, icon: TargetIcon },
  assistant: { id: "assistant", label: "Talk to Asha", text: "Ask a question or just talk, in Bangla or English", href: `${P}/assistant`, icon: ChatIcon },
  move: { id: "move", label: "Move", text: "Guided exercise, one step at a time", href: `${P}/move`, icon: MoveIcon },
  nutrition: { id: "nutrition", label: "Nutrition", text: "Log a meal and see a sourced estimate", href: `${P}/nutrition`, icon: NutritionIcon },
  outlook: { id: "outlook", label: "Health outlook", text: "Risk alerts from your signals, heat and air, with a plan for today", href: `${P}/outlook`, icon: ShieldIcon },
  vitalsense: { id: "vitalsense", label: "VitalSense", text: "Experimental pulse and breathing estimate", href: `${P}/vitalsense`, icon: HeartIcon },
  posture: { id: "posture", label: "Posture", text: "Position and comfort", href: `${P}/posture`, icon: PostureIcon },
  care: { id: "care", label: "Care journal", text: "Note how you feel, get support and prepare for your next visit", href: `${P}/care`, icon: JournalIcon },
};

const M = MODULES;
export const AREAS: Area[] = [
  {
    id: "communicate",
    label: "Communicate",
    text: "Ask for help, or send messages with your face, eyes, hands or voice.",
    href: `${P}/communicate`,
    icon: SparkIcon,
    modules: [M.help, M.facespeak, M.eyespeak, M.fingerspeak, M.senseassist, M.calibration],
  },
  { id: "talk", label: "Talk to Asha", text: "Ask a question or just talk, in Bangla or English.", href: M.assistant.href, icon: ChatIcon, modules: [M.assistant] },
  { id: "exercise", label: "Exercise", text: "Short guided routines with a safety check first.", href: M.move.href, icon: MoveIcon, modules: [M.move] },
  { id: "food", label: "Nutrition", text: "Log what you ate and see a sourced calorie estimate.", href: M.nutrition.href, icon: NutritionIcon, modules: [M.nutrition] },
  { id: "wellbeing", label: "Wellbeing", text: "Risk alerts and a plan for today, gentle checks for pulse, breathing and posture, and a care journal.", href: `${P}/wellbeing`, icon: HeartIcon, modules: [M.outlook, M.vitalsense, M.posture, M.care] },
];

export const areaById = (id: string) => AREAS.find((a) => a.id === id);

/** The area and module a dashboard path belongs to, or null for Home, Settings and the like. */
export function locate(pathname: string): { area: Area; module: Module | null } | null {
  for (const area of AREAS) {
    const module = [...area.modules].sort((a, b) => b.href.length - a.href.length).find((m) => pathname === m.href || pathname.startsWith(m.href + "/"));
    if (module) return { area, module };
    if (pathname === area.href) return { area, module: null };
  }
  return null;
}
