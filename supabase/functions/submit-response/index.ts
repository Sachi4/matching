// 感想の投稿 → embedding生成 → stimulus_responses へのinsert を行うEdge Function
// （共鳴判定はトーンの診断質問回答後に check-resonance で行う）
import { createClient } from "npm:@supabase/supabase-js@2";

const EMBEDDING_DIM = 1536;

// 本番ではALLOWED_ORIGINにフロントのオリジンを設定して呼び出し元を制限する
const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MAX_TEXT_LENGTH = 500;
const MAX_WORDS = 20;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// OpenAI embedding API。キー未設定時はローカルの決定的擬似embeddingにフォールバック
// （デモ・開発環境をAPIキーなしで動かすため。本番はOPENAI_API_KEYを設定すること）
async function generateEmbedding(text: string): Promise<number[]> {
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const { participant_id, stimulus_id, free_text, hint_words_selected } =
      await req.json();
    if (
      typeof participant_id !== "string" ||
      !UUID_RE.test(participant_id) ||
      typeof stimulus_id !== "string" ||
      !UUID_RE.test(stimulus_id)
    ) {
      return json({ error: "participant_id / stimulus_id が不正です" }, 400);
    }
    if (free_text != null && typeof free_text !== "string") {
      return json({ error: "free_text が不正です" }, 400);
    }
    if ((free_text ?? "").length > MAX_TEXT_LENGTH) {
      return json(
        { error: `free_text は${MAX_TEXT_LENGTH}文字以内にしてください` },
        400,
      );
    }
    if (
      hint_words_selected != null &&
      (!Array.isArray(hint_words_selected) ||
        hint_words_selected.length > MAX_WORDS ||
        hint_words_selected.some(
          (w) => typeof w !== "string" || w.length > 30,
        ))
    ) {
      return json({ error: "hint_words_selected が不正です" }, 400);
    }
    const words: string[] = hint_words_selected ?? [];
    const text = [words.join("、"), (free_text ?? "").trim()]
      .filter(Boolean)
      .join("。");
    if (!text) {
      return json(
        { error: "ヒント語か自由記述のどちらかを入力してください" },
        400,
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const embedding = await generateEmbedding(text);

    const { data: response, error: insertError } = await supabase
      .from("stimulus_responses")
      .insert({
        participant_id,
        stimulus_id,
        hint_words_selected: words,
        free_text: (free_text ?? "").trim(),
        embedding,
      })
      .select("id")
      .single();
    if (insertError) throw insertError;

    return json({ response_id: response.id });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
