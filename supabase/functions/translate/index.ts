// Translates one chat message and writes the result back to public.messages.
// Called by the app right after it inserts a message (and again for "Tekrar çevir").
// Voice messages arrive with the translation Gemini Live already spoke; the sender passes it as `translation`
// so the text matches what the listener heard.
// Clients cannot write translated_text themselves; this function does it with the service role.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const LANGUAGE_NAMES: Record<string, string> = {
  tr: "Turkish", en: "English", de: "German", fr: "French", es: "Spanish", it: "Italian",
  ru: "Russian", ar: "Arabic", ja: "Japanese", ko: "Korean", th: "Thai", tk: "Turkmen",
};
const languageName = (code: string) => LANGUAGE_NAMES[code] || code;

const GEMINI_MODELS = ["gemini-1.5-flash", "gemini-2.5-flash", "gemini-1.5-pro", "gemini-3.8-flash"];

async function translateWithGemini(text: string, target: string, source?: string): Promise<string | null> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return null;

  const prompt = `You are a professional, native-level translator.
Translate the following text into ${languageName(target)}.
${source ? `The source language is ${languageName(source)}.` : "Automatically detect the source language."}

Respond ONLY with the translated text. Do not include any explanations, surrounding quotes, or conversational filler. Keep all emojis and formatting exact.

Text to translate:
"${text}"`;

  for (const model of GEMINI_MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.1 },
          }),
          signal: AbortSignal.timeout(12000),
        },
      );
      if (!res.ok) {
        console.warn(`Gemini ${model} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
        // Quota / spending cap: the other model shares it, go straight to the backups
        if (res.status === 429) return null;
        continue;
      }
      const data = await res.json();
      const out = (data?.candidates?.[0]?.content?.parts ?? [])
        .map((p: { text?: string }) => p.text ?? "")
        .join("")
        .trim()
        .replace(/^["']|["']$/g, "");
      if (out) return out;
    } catch (err) {
      console.warn(`Gemini ${model} error:`, err instanceof Error ? err.message : err);
    }
  }
  return null;
}

async function translateWithGoogleWeb(text: string, target: string, source?: string) {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=tw-ob&sl=${source || "auto"}&tl=${target}&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data?.[0])) return null;
    const translated = data[0].map((item: unknown[]) => item[0]).join("");
    return translated ? { text: translated as string, detected: (data[2] as string) || source } : null;
  } catch (err) {
    console.warn("Google web backup failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function translateWithMyMemory(text: string, target: string, source?: string) {
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${source || "autodetect"}|${target}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const data = await res.json();
    const translated: string | undefined = data?.responseData?.translatedText;
    if (!translated || translated.startsWith("MYMEMORY WARNING")) return null;
    return {
      text: translated
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">"),
      detected: (data?.responseData?.detectedLanguage as string) || source,
    };
  } catch (err) {
    console.warn("MyMemory backup failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function translate(text: string, target: string, sourceIn?: string | null) {
  const source = sourceIn && sourceIn !== "auto" && sourceIn !== "detected" ? sourceIn : undefined;
  if (source && source.toLowerCase() === target.toLowerCase()) return { text, detected: source };

  const gemini = await translateWithGemini(text, target, source);
  if (gemini) return { text: gemini, detected: source };

  return (await translateWithGoogleWeb(text, target, source))
    ?? (await translateWithMyMemory(text, target, source));
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let messageId: string | undefined;
  let spoken: string | undefined;
  try {
    ({ message_id: messageId, translation: spoken } = await req.json());
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!messageId) return json({ error: "message_id is required" }, 400);

  const url = Deno.env.get("SUPABASE_URL")!;

  // Read the message as the caller: RLS only returns it if they are a member of the room
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: msg, error: readError } = await asUser
    .from("messages")
    .select("id, sender_id, is_voice, original_text, original_language, target_language, translation_status")
    .eq("id", messageId)
    .maybeSingle();
  if (readError) return json({ error: readError.message }, 500);
  if (!msg) return json({ error: "Message not found" }, 404);
  if (msg.translation_status === "completed") return json({ status: "completed" });

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if (msg.translation_status === "error") {
    await admin.from("messages").update({ translation_status: "pending" }).eq("id", msg.id);
  }

  // Only the sender may supply the spoken translation of their own voice message
  let fromVoice = false;
  if (msg.is_voice && typeof spoken === "string" && spoken.trim()) {
    const { data: { user } } = await asUser.auth.getUser();
    fromVoice = user?.id === msg.sender_id;
  }
  const result = fromVoice
    ? { text: spoken!.trim().slice(0, 4000), detected: msg.original_language }
    : await translate(msg.original_text, msg.target_language || "en", msg.original_language);
  const update = result
    ? { translated_text: result.text, original_language: result.detected || msg.original_language, translation_status: "completed" }
    : { translation_status: "error" };

  const { error: writeError } = await admin.from("messages").update(update).eq("id", msg.id);
  if (writeError) return json({ error: writeError.message }, 500);
  return json({ status: update.translation_status });
});
