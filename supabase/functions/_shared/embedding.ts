// 感想のembedding生成。submit-response（新規投稿）と reembed-responses（作り直し）で共有する。
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export const EMBEDDING_DIM = 1536;
const GEMINI_EMBEDDING_MODEL = "gemini-embedding-2";

export type StimulusImage = { mimeType: string; base64: string };

// Gemini のマルチモーダルembedding。感想文と、その感想が向けられた刺激画像を
// 1つのベクトルに集約する（画像とテキストが同じ空間に写るため、
// 「どの画像に対してどう感じたか」まで含めて共鳴を測れる）
async function geminiEmbedding(
  text: string,
  image: StimulusImage | null,
): Promise<number[]> {
  const apiKey = Deno.env.get("GEMINI_API_KEY")!;
  const parts: Record<string, unknown>[] = [];
  if (image) {
    parts.push({
      inline_data: { mime_type: image.mimeType, data: image.base64 },
    });
  }
  parts.push({ text });
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:embedContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        content: { parts },
        output_dimensionality: EMBEDDING_DIM,
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`gemini embedding error: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.embedding.values as number[];
}

// 刺激画像をbase64で取得する。SVGはGeminiが受け付けないため、PNG/JPEGのみを対象にする
// （stimuli.embed_image_url に埋め込み用のラスタ画像を持たせている）。
// 画像は数枚しかないのでインスタンス内でキャッシュする
const imageCache = new Map<string, StimulusImage>();

export async function loadStimulusImage(
  supabase: SupabaseClient,
  stimulusId: string,
): Promise<StimulusImage | null> {
  const cached = imageCache.get(stimulusId);
  if (cached) return cached;

  const { data, error } = await supabase
    .from("stimuli")
    .select("embed_image_url, image_url")
    .eq("id", stimulusId)
    .single();
  if (error) throw error;
  const path = (data.embed_image_url ?? data.image_url) as string | null;
  if (!path) return null;
  const mimeType = path.endsWith(".png")
    ? "image/png"
    : /\.jpe?g$/.test(path)
      ? "image/jpeg"
      : null;
  if (!mimeType) return null;

  // 相対パスのときだけ PUBLIC_SITE_URL を基準にする（Storageの公開URLなどはそのまま取りに行く）
  const siteUrl = Deno.env.get("PUBLIC_SITE_URL");
  if (!/^https?:\/\//.test(path) && !siteUrl) return null;
  const res = await fetch(new URL(path, siteUrl).toString());
  if (!res.ok) {
    throw new Error(`stimulus image fetch failed: ${res.status} ${path}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const image = { mimeType, base64: btoa(binary) };
  imageCache.set(stimulusId, image);
  return image;
}

// 画像が取れなくても感想文だけで共鳴は測れるので、失敗してもテキストのみで続行する
export async function loadStimulusImageOrNull(
  supabase: SupabaseClient,
  stimulusId: string,
): Promise<StimulusImage | null> {
  try {
    return await loadStimulusImage(supabase, stimulusId);
  } catch (e) {
    console.error("stimulus image unavailable:", e);
    return null;
  }
}

// embedding生成。GEMINI_API_KEY があれば画像＋テキストのマルチモーダル、
// なければ OpenAI のテキストのみ、どちらも無ければローカルの決定的擬似embedding
// （デモ・開発環境をAPIキーなしで動かすため）
export async function generateEmbedding(
  text: string,
  image: StimulusImage | null,
): Promise<number[]> {
  if (Deno.env.get("GEMINI_API_KEY")) {
    return geminiEmbedding(text, image);
  }
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (apiKey) {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text,
      }),
    });
    if (!res.ok) {
      throw new Error(`embedding API error: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    return data.data[0].embedding as number[];
  }
  return localEmbedding(text);
}

// 文字bigramのハッシュに基づく決定的擬似embedding（コサイン類似度が
// 表層的な語彙の重なりを反映する程度の簡易フォールバック）
function localEmbedding(text: string): number[] {
  const vec = new Array(EMBEDDING_DIM).fill(0);
  const normalized = text.normalize("NFKC").toLowerCase();
  for (let i = 0; i < normalized.length - 1; i++) {
    const gram = normalized.slice(i, i + 2);
    let h = 2166136261;
    for (const ch of gram) {
      h ^= ch.codePointAt(0)!;
      h = Math.imul(h, 16777619);
    }
    vec[Math.abs(h) % EMBEDDING_DIM] += 1;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

// 感想文（ヒント語＋自由記述）の組み立て。投稿時と再生成で同じ文字列になるようにする
export function responseText(
  hintWords: string[] | null,
  freeText: string | null,
): string {
  return [(hintWords ?? []).join("、"), (freeText ?? "").trim()]
    .filter(Boolean)
    .join("。");
}
