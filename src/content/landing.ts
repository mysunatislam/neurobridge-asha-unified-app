// All landing-page copy and data in one place. Sections render from this file.
export const site = {
  appUrl: "/dashboard/patient",
  registerUrl: "/register",
  loginUrl: "/login",
  demoUrl: "/dashboard/patient/facespeak",
  caregiverUrl: "/dashboard/caregiver",
  sourceUrl: "https://github.com/mysunatislam/neurobridge-asha-unified-app",
};

export const nav = [
  { label: "Why Asha", href: "#why" },
  { label: "Modules", href: "#modules" },
  { label: "Kit", href: "#kit" },
  { label: "Plans", href: "#plans" },
  { label: "Team", href: "#team" },
  { label: "Contact", href: "#contact" },
];

export const hero = {
  badge: "Assistive communication, reimagined",
  title: "A little support. A lot more independence.",
  lead: "When words are hard, connection shouldn’t be. Meet Asha — the companion that helps people express their needs in their own way.",
  primary: { label: "Try Asha", href: site.appUrl },
  secondary: { label: "Book a guided demo", href: "#contact" },
  video: {
    // The final Asha film, played in YouTube's player inside the hero frame.
    src: "",
    youtubeId: "DjKs46e9W8g",
    poster: undefined,
    posterAlt: "Asha companion demo",
    label: "Watch the demo",
    duration: "The Asha film, on YouTube",
  },
};

export const journeys = [
  { n: "01", title: "Recovery & rehabilitation", text: "After stroke, neurological illness or an accident." },
  { n: "02", title: "Complex communication needs", text: "For people who use alternative ways to express themselves." },
  { n: "03", title: "Ageing & bedside care", text: "For everyday needs when reaching or calling is difficult." },
];

export const story = {
  eyebrow: "Why we’re building Asha",
  title: "Silence shouldn’t mean being alone.",
  paragraphs: [
    "A neurological illness took a grandfather’s speech. His needs were still there. His way to call for help wasn’t.",
    "That experience is at the heart of Asha: a bridge between what a person wants to say and the people who care for them. Not another complicated dashboard — a calmer way to communicate, with support that adapts to what someone can comfortably do.",
  ],
};

export const modulesIntro = {
  eyebrow: "Many ways to say “I need you”",
  title: "One companion. Your way to connect.",
  lead: "Speech, eyes, face or hands. A caregiver helps assess what works; Asha recommends a starting point without locking anyone out.",
  video: { src: "", poster: undefined, posterAlt: "Asha modules in use", label: "See the modules", duration: "" },
};

export type ModuleKey = "facespeak" | "eyespeak" | "fingerspeak" | "senseassist" | "vitalsense" | "posture" | "move" | "nutrition";
export const modules: { key: ModuleKey; name: string; title: string; text: string }[] = [
  { key: "facespeak", name: "FaceSpeak", title: "A movement can become a message.", text: "Guided calibration learns a personal baseline for deliberate blinks, smiles and head movements. A separate confirmation keeps ordinary movement from becoming an unintended request." },
  { key: "eyespeak", name: "EyeSpeak", title: "Your eyes. Your words.", text: "Spell a word or pick a phrase by looking at it, with touch or a single switch always available. Eye tracking is experimental and checks its own accuracy before it can select anything." },
  { key: "fingerspeak", name: "FingerSpeak", title: "Hands and fingers, understood.", text: "Practise comfortable gestures and map them to phrases. Asha speaks the phrase and can send it to the caregiver after confirmation." },
  { key: "senseassist", name: "SenseAssist", title: "Clearer speech, together.", text: "Asha suggests a meaning for unclear speech in Bangla or English. The person confirms before anything is spoken or sent." },
  { key: "vitalsense", name: "VitalSense", title: "A gentle signal check.", text: "Experimental camera-based pulse estimates for awareness only — not a clinical measurement." },
  { key: "posture", name: "Posture", title: "Comfort at a glance.", text: "On-device posture sensing helps caregivers notice when someone may need repositioning." },
  { key: "move", name: "Move", title: "Movement, at your own pace.", text: "Short guided routines with a demonstration and a practice try first. The camera counts only what it can see, and fixed safety rules stop a workout when warning signs appear." },
  { key: "nutrition", name: "Nutrition", title: "Meals, honestly estimated.", text: "Choose what you ate, or try the experimental photo suggestion for a few fruits. Asha asks a few short questions and gives a sourced calorie estimate, and says so when it can\u2019t tell." },
];

export const steps = [
  { n: "01", tag: "Adapt", title: "Start with the person.", text: "A caregiver sets up movement, speech, vision and hearing preferences. Practise the signals that feel comfortable." },
  { n: "02", tag: "Understand", title: "Support, not pressure.", text: "Asha explains the next step, offers gentle check-ins and helps clarify speech. The patient confirms their meaning." },
  { n: "03", tag: "Connect", title: "Close the loop.", text: "Confirmed requests reach the assigned care circle. The patient can see when a caregiver acknowledges them." },
];

export const kit = {
  eyebrow: "Optional Asha Kit · proposed hardware add-on",
  title: "Support that fits your space.",
  lead: "Start with your own compatible phone or tablet. Explore an optional camera, switch and mount when a more stable bedside setup would help.",
  image: { src: "/assets/kit-placement.svg", alt: "Illustrative placement of a tablet, camera, mount and switch beside a bed" },
  caption: "Illustrative placement — not a photograph of a shipping kit.",
  price: "$100 one-time · planned launch price",
  parts: [
    { key: "camera", title: "Camera + clear view", text: "Position the screen so the person can see it comfortably and the camera has a clear view of the face." },
    { key: "mount", title: "Adjustable mount", text: "Choose a secure mounting point with the caregiver. Check angle, stability and cable route." },
    { key: "switch", title: "Optional assistive switch", text: "A comfortable, reachable switch for people who prefer a physical input. Compatibility is checked first." },
  ],
  privacy: {
    title: "Camera sensing stays on the device",
    text: "Face, hand and posture sensing run locally in the browser. AI clarification uses the cloud only after opt-in, and secret keys stay on the server.",
  },
};

export const languages = {
  greetings: [
    { text: "আমি এখানে আছি", lang: "bn" },
    { text: "I’m here", lang: "en" },
    { text: "পানি চাই", lang: "bn" },
    { text: "I need help", lang: "en" },
  ],
  title: "Bangla + English",
  text: "Asha listens, speaks and clarifies in Bangla, English or a mix of both — so people can communicate in the language that feels like home.",
};

export const plans = [
  {
    audience: "Individuals & families",
    name: "Asha Plus",
    price: "$5",
    period: "/ month",
    summary: "Everyday communication and a connected caregiver.",
    features: ["Core communication interfaces", "Adaptive access and AI sentence support", "Bangla + English companion support", "Caregiver requests and history"],
    cta: "Discuss home support",
    note: "Proposed subscription · not yet sold online",
    interest: "homecare",
  },
  {
    audience: "Advanced home care & care teams",
    name: "Asha Pro",
    price: "$12",
    period: "/ month",
    summary: "A proposed path to more personalised care support.",
    features: ["Everything proposed in Asha Plus", "Planned advanced AI personalisation", "Care-workflow and reporting options", "Onboarding scope agreed with your team"],
    cta: "Discuss a care pilot",
    note: "Proposed subscription · scope confirmed after demo",
    interest: "hospital",
    featured: true,
  },
  {
    audience: "Optional hardware add-on",
    name: "Asha Kit",
    price: "$100",
    period: "/ once",
    summary: "A more stable setup, when it suits the person.",
    features: ["Camera, assistive switch and mount", "Phone / tablet excluded", "Subscription separate", "No required kit purchase"],
    cta: "Enquire about the kit",
    note: "Planned one-time price · compatibility check first",
    interest: "kit",
  },
] as const;

export const plansNote =
  "USD reference prices from the pitch deck — not a checkout or a payment request. The team confirms a written quote, availability and any delivery or installation scope.";

export const principles = [
  { title: "Ability first.", text: "Large controls, spoken guidance and clear text. Details appear when you want them." },
  { title: "Private by choice.", text: "Camera sensing runs locally. AI clarification uses the cloud after opt-in; secret keys stay on the server." },
  { title: "People stay in control.", text: "Interpretations are suggestions. Care requests need confirmation. Asha supports human care, not replaces it." },
];

export type SocialKey = "github" | "linkedin" | "facebook";
export const team: { name: string; role: string; photo: string; socials: Partial<Record<SocialKey, string>> }[] = [
  {
    name: "Mysunat Islam",
    role: "CEO",
    photo: "/assets/team/mysunat.webp",
    socials: {
      github: "https://github.com/mysunatislam",
      linkedin: "https://www.linkedin.com/in/mysunat-islam-8742b3242/",
      facebook: "https://www.facebook.com/mysunat.islam",
    },
  },
  {
    name: "Md Sifat Bin Jibon",
    role: "COO",
    photo: "/assets/team/jibon.webp",
    socials: {
      github: "https://github.com/Md-Sifat-Bin-Jibon",
      linkedin: "https://www.linkedin.com/in/mdsifatbinjibon/",
      facebook: "https://www.facebook.com/sifatbinjibon046",
    },
  },
  {
    name: "Hasibul Hasan Rahim",
    role: "CTO",
    photo: "/assets/team/rahim.webp",
    socials: { facebook: "https://www.facebook.com/Rah1mm" },
  },
];

export const faqs = [
  { q: "Can I try it without setting up a patient?", a: "Yes. Try every module in the live demo. Create a private care circle only to test delivery between patient and caregiver devices." },
  { q: "Does Asha diagnose health conditions?", a: "No. Asha is an assistive communication prototype, not a diagnostic or emergency service. VitalSense produces experimental camera estimates, not clinical measurements." },
  { q: "How does the AI help?", a: "It offers brief conversation and guidance, and suggests meanings for unclear speech. Retrieved app guidance and confirmed speech pairs ground replies; patients check interpretations before sending requests." },
  { q: "Is Asha ready for a hospital-wide rollout?", a: "The live prototype is available to explore. Supervised validation and pilot evaluation come next. We welcome conversations with care teams and accessibility partners." },
];

export const contact = {
  email: "mysunatislam@gmail.com",
  phoneDisplay: "01641576801",
  phoneHref: "tel:+8801641576801",
  whatsapp: "https://wa.me/8801641576801",
  disclaimer: "Business enquiries only. Please don’t include patient names, medical records or urgent requests. This is not an emergency contact service.",
};

export const closing = {
  title: "A little support. A world of difference.",
  primary: { label: "Try Asha", href: site.appUrl },
  secondary: { label: "Book a demo", href: "#contact" },
};

export const footer = {
  tagline: "Care that understands beyond words.",
  groups: [
    { title: "Product", links: [{ label: "Try Asha", href: site.appUrl }, { label: "Modules", href: "#modules" }, { label: "Hardware kit", href: "#kit" }, { label: "Plans", href: "#plans" }, { label: "How Asha uses AI", href: "/ai" }] },
    { title: "Company", links: [{ label: "Why Asha", href: "#why" }, { label: "Team", href: "#team" }, { label: "Contact", href: "#contact" }] },
    { title: "Connect", links: [{ label: "Email", href: "mailto:mysunatislam@gmail.com" }, { label: "WhatsApp", href: "https://wa.me/8801641576801" }, { label: "Source", href: site.sourceUrl }] },
  ],
  legal: "© 2026 ASHA / NeuroBridge · Assistive communication prototype. Not an emergency service.",
};
