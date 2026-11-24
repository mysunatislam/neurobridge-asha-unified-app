import { retrieveKnowledge } from "../server/lib/retrieval.js";

// A reply built only from Asha's own versioned guide, with no AI model. It is used when cloud
// assistance is off, when there is no linked care circle and no network, or when every cloud
// model failed. It never invents facts: it quotes the guide or says what Asha can do.

const OVERVIEW = {
  en: "I can explain any part of Asha and help you ask for water, food, the toilet, comfort or your caregiver. You can talk with your face (FaceSpeak), eyes (EyeSpeak), hands (FingerSpeak) or voice (SenseAssist), follow guided exercise in Move, log meals in Nutrition, and see risk alerts with a prevention plan in Health outlook.",
  bn: "আমি Asha-র যেকোনো অংশ বুঝিয়ে দিতে পারি, আর পানি, খাবার, টয়লেট, আরাম বা কেয়ারগিভারকে ডাকতে সাহায্য করতে পারি। মুখ (FaceSpeak), চোখ (EyeSpeak), হাত (FingerSpeak) বা কণ্ঠ (SenseAssist) দিয়ে কথা বলতে পারেন, Move-এ ব্যায়াম, Nutrition-এ খাবার লেখা, আর Health outlook-এ ঝুঁকির সতর্কতা ও প্রতিরোধ পরিকল্পনা দেখতে পারেন।",
};

// Urgent words come first: the guide never tries to handle an emergency itself.
const URGENT = [
  /chest pain|can'?t breathe|cannot breathe|short of breath|faint(?:ed|ing)?\b|unconscious|seizure|stroke|face (?:is )?droop|slurred|bleeding a lot|suicid|kill myself|বুকে ব্যথা|শ্বাস নিতে পারছি না|শ্বাসকষ্ট|অজ্ঞান|খিঁচুনি|স্ট্রোক/iu,
  "This could be urgent. Please call your local emergency number now (999 in Bangladesh), and use Ask for help so someone near you knows. I can't call anyone for you.",
  "এটা জরুরি হতে পারে। এখনই আপনার স্থানীয় জরুরি নম্বরে (বাংলাদেশে ৯৯৯) ফোন করুন, আর Ask for help দিয়ে কাছের কাউকে জানান। আমি নিজে কাউকে ফোন করতে পারি না।",
];

// Everyday wellbeing: short, general, safe tips. No diagnosis, no doses.
const WELLBEING = [
  [/\b(?:dizzy|dizziness|light-?headed|vertigo)\b|মাথা ঘোর/iu,
    "Please sit or lie down somewhere safe, sip some water and breathe slowly. Don't stand up quickly. If it doesn't pass in a few minutes, or comes with chest pain, weakness or trouble speaking, ask for help or call your emergency number.",
    "নিরাপদ জায়গায় বসুন বা শুয়ে পড়ুন, একটু পানি খান আর ধীরে শ্বাস নিন। হঠাৎ উঠে দাঁড়াবেন না। কয়েক মিনিটে না কমলে, বা বুকে ব্যথা, দুর্বলতা বা কথা বলতে সমস্যা হলে সাহায্য চান বা জরুরি নম্বরে ফোন করুন।"],
  [/\b(?:pain|hurts?|ache|aching|sore)\b|ব্যথা/iu,
    "I'm sorry you're in pain. Try to rest in a comfortable position and tell your caregiver where it hurts; you can use Ask for help to call them. I can't advise on medicines. If the pain is severe or sudden, call your emergency number.",
    "আপনার ব্যথা হচ্ছে শুনে খারাপ লাগছে। আরামদায়ক ভঙ্গিতে বিশ্রাম নিন আর কেয়ারগিভারকে বলুন কোথায় ব্যথা; Ask for help দিয়ে ডাকতে পারেন। ওষুধের পরামর্শ আমি দিতে পারি না। ব্যথা তীব্র বা হঠাৎ হলে জরুরি নম্বরে ফোন করুন।"],
  [/\b(?:hot|heat|sweat\w*|cool(?: down)?|warm)\b|গরম|ঘাম|ঠান্ডা থাক/iu,
    "To stay cool: sip water often, rest in shade or near a fan, wear light loose clothes and put a cool damp cloth on your neck and wrists. If you feel dizzy, confused or stop sweating in the heat, ask for help right away. Health outlook shows today's heat and humidity.",
    "ঠান্ডা থাকতে: বারবার অল্প করে পানি খান, ছায়ায় বা ফ্যানের কাছে বিশ্রাম নিন, হালকা ঢিলা কাপড় পরুন, ঘাড় ও কব্জিতে ভেজা ঠান্ডা কাপড় দিন। গরমে মাথা ঘোরা, বিভ্রান্তি বা ঘাম বন্ধ হলে সঙ্গে সঙ্গে সাহায্য চান। Health outlook-এ আজকের গরম ও আর্দ্রতা দেখুন।"],
  [/\b(?:tired|exhausted|fatigue\w*|weak|no energy|sleepy)\b|ক্লান্ত|দুর্বল|ঘুম ঘুম/iu,
    "Feeling tired is hard. A short rest, some water and a light snack can help, and gentle stretching in Move may lift your energy. If you feel much weaker than usual or it keeps getting worse, tell your caregiver.",
    "ক্লান্ত লাগা কষ্টের। একটু বিশ্রাম, পানি আর হালকা খাবার সাহায্য করতে পারে, আর Move-এর হালকা স্ট্রেচিং শক্তি ফেরাতে পারে। স্বাভাবিকের চেয়ে অনেক দুর্বল লাগলে বা বাড়তে থাকলে কেয়ারগিভারকে জানান।"],
  [/\b(?:can'?t sleep|insomnia|sleep|awake at night)\b|ঘুম আসছে না|ঘুম হচ্ছে না|ঘুম/iu,
    "For better sleep: keep the room dark and cool, avoid screens and tea or coffee late in the day, and try slow breathing, in for four counts and out for six. If poor sleep goes on for weeks, mention it to your doctor.",
    "ভালো ঘুমের জন্য: ঘর অন্ধকার ও ঠান্ডা রাখুন, বিকেলের পর চা-কফি ও স্ক্রিন এড়ান, আর ধীরে শ্বাস নিন, চার গুনে নিন, ছয় গুনে ছাড়ুন। কয়েক সপ্তাহ ঘুম খারাপ থাকলে ডাক্তারকে বলুন।"],
  [/\b(?:sad|lonely|alone|depress\w*|anxious|anxiety|worried|scared|afraid|stress\w*|upset|bored)\b|মন খারাপ|একা|ভয়|চিন্তা|দুশ্চিন্তা/iu,
    "Thank you for telling me. Those feelings are real and you don't have to carry them alone. Try a few slow breaths, and consider letting your caregiver or someone you trust know how you feel. I'm happy to keep you company here too.",
    "আমাকে বলার জন্য ধন্যবাদ। এই অনুভূতিগুলো সত্যি, আর একা বইতে হবে না। কয়েকবার ধীরে শ্বাস নিন, আর কেয়ারগিভার বা বিশ্বস্ত কাউকে জানাতে পারেন কেমন লাগছে। আমিও এখানে আপনার সঙ্গে আছি।"],
  [/\b(?:thank|thanks|thank you)\b|ধন্যবাদ/iu,
    "You're welcome. I'm here whenever you want to talk or need something.",
    "আপনাকেও ধন্যবাদ। কথা বলতে বা কিছু লাগলে আমি আছি।"],
  [/\b(?:how are you|good morning|good night|good evening)\b|কেমন আছ|শুভ সকাল|শুভ রাত্রি/iu,
    "I'm here and ready to help. How are you feeling today?",
    "আমি আছি, সাহায্য করতে তৈরি। আজ আপনার কেমন লাগছে?"],
];

const TOPICS = [
  [/eye ?speak|eye typing|spell|চোখ দিয়ে লিখ/iu, "EyeSpeak lets you spell words or pick phrases by looking at large tiles; a slow blink or a steady look chooses, and nothing is sent until you confirm."],
  [/face ?speak|blink|smile|পলক|হাসি/iu, "FaceSpeak reads practised blinks, smiles and head movements as yes, no or a need. Each request opens a separate confirmation before your caregiver gets it."],
  [/finger ?speak|gesture|hand|হাত|আঙুল/iu, "FingerSpeak turns hand and finger gestures into requests, with a confirmation step before anything is sent."],
  [/vital|pulse|heart|breath|শ্বাস|নাড়ি|হৃদ/iu, "VitalSense gives an experimental camera estimate of pulse and breathing for awareness only. It is not a medical measurement; use a validated device for health decisions."],
  [/move|exercise|workout|ব্যায়াম/iu, "Move offers short guided routines with a safety check first. It stops and suggests rest if you report warning symptoms."],
  [/nutrition|meal|food log|calorie|kcal|খাবার লেখ|ক্যালরি/iu, "Nutrition logs a meal from a photo, an upload or a manual pick and shows a sourced calorie range. Photos are never stored."],
  [/risk|alert|outlook|heat|air|aqi|humid|weather|prevent|গরম|বায়ু|ঝুঁকি/iu, "Health outlook combines your recent signals with local heat, humidity and air quality, explains each alert, and suggests a prevention plan for today. It is decision support, not a diagnosis."],
  [/sense ?assist|speech|voice|কণ্ঠ|কথা/iu, "SenseAssist listens to unclear speech and suggests what you most likely said, for you to confirm. It never acts on a guess."],
];

const firstSentences = (text, n = 2) =>
  (String(text).match(/[^.!?।]+[.!?।]+/gu) || [String(text)])
    .slice(0, n)
    .join(" ")
    .trim();

/**
 * @param {{ query: string, module?: string, language?: string, reason?: "offline"|"cloud_off"|"cloud_failed" }} input
 * @returns {{ reply: string, sources: {id:string,title:string}[], answeredBy: "guide" }}
 */
export function guideAnswer({ query, module = "companion", language = "en" }) {
  const lang = language === "bn" || /[ঀ-৿]/u.test(query || "") ? "bn" : "en";
  const text = String(query || "").trim();
  if (URGENT[0].test(text))
    return { reply: lang === "bn" ? URGENT[2] : URGENT[1], sources: [], answeredBy: "guide", urgent: true };
  const care = WELLBEING.find(([pattern]) => pattern.test(text));
  const appTopic = TOPICS.find(([pattern]) => pattern.test(text));
  // A question about the app (e.g. "how does Health outlook use heat?") beats a wellbeing tip.
  const asksAboutApp = /\b(?:how|what|where|explain|does|use)\b.*\b(?:asha|app|outlook|move|nutrition|eyespeak|facespeak|fingerspeak|vitalsense|senseassist)\b/iu.test(text);
  if (care && !(appTopic && asksAboutApp))
    return { reply: lang === "bn" ? care[2] : care[1], sources: [], answeredBy: "guide" };
  const topic = appTopic;
  const sources = text ? retrieveKnowledge({ query: text, module, limit: 2 }) : [];
  const general = !text || /^(?:hi|hello|hey|help|what can you|who are you|what do you do|হ্যালো|হাই|তুমি কে|আপনি কে)/iu.test(text);
  let reply;
  if (general || (!topic && !sources.length)) reply = OVERVIEW[lang];
  else if (topic) reply = topic[1];
  else reply = firstSentences(sources[0].text);
  if (lang === "bn" && reply !== OVERVIEW.bn) reply = "Asha-র গাইড থেকে: " + reply;
  return {
    reply,
    sources: topic || general ? [] : sources.slice(0, 1).map(({ id, title }) => ({ id, title })),
    answeredBy: "guide",
  };
}

/** The guide's sentence on the app feature a message names, as a source an AI reply can cite. */
export function guideTopic(query) {
  const text = String(query || "");
  const index = TOPICS.findIndex(([pattern]) => pattern.test(text));
  if (index < 0) return null;
  return { id: `asha-guide-${index}`, title: "Asha guide", text: TOPICS[index][1] };
}
