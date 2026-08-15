// 感想の投稿 → embedding生成 → 共鳴判定 → matches insert → 反応名生成
// を1リクエストで行うEdge Function
import { createClient } from "npm:@supabase/supabase-js@2";

const EMBEDDING_DIM = 1536;

// 本番ではALLOWED_ORIGINにフロントのオリジンを設定して呼び出し元を制限する
const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MAX_TEXT_LENGTH = 500;
const MAX_TAGS = 20;

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

// Claude APIで2つの感想文から詩的な短い「反応名」を生成。
// キー未設定時は2つの感想の断片を組み合わせる簡易フォールバック
async function generateReactionPhrase(
  textA: string,
  textB: string,
): Promise<string> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (apiKey) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-3-5-haiku-latest",
          max_tokens: 50,
          messages: [
            {
              role: "user",
              content:
                `同じ抽象画像を見た2人の感想です。\n感想1:「${textA}」\n感想2:「${textB}」\n\n` +
                `2人の感じ方の共鳴を表す、詩的で短い日本語の言葉（3〜10文字程度）を1つだけ、` +
                `かぎ括弧や説明なしで出力してください。`,
            },
          ],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const phrase = (data.content?.[0]?.text ?? "").trim();
        if (phrase) return phrase.slice(0, 20);
      } else {
        console.error("Claude API error:", res.status, await res.text());
      }
    } catch (e) {
      console.error("Claude API call failed:", e);
    }
  }
  return fallbackPhrase(textA, textB);
}

function fallbackPhrase(textA: string, textB: string): string {
  const frag = (t: string) =>
    t.replace(/[、。！？\s,.!?]/g, "").slice(0, 4) || "ゆらぎ";
  return `${frag(textA)}と${frag(textB)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const { participant_id, stimulus_id, response_text, selected_tags } =
      await req.json();
    if (!participant_id || !stimulus_id || !response_text) {
      return json(
        { error: "participant_id, stimulus_id, response_text は必須です" },
        400,
      );
    }
    if (
      typeof participant_id !== "string" ||
      !UUID_RE.test(participant_id) ||
      typeof stimulus_id !== "string" ||
      !UUID_RE.test(stimulus_id)
    ) {
      return json({ error: "participant_id / stimulus_id が不正です" }, 400);
    }
    if (
      typeof response_text !== "string" ||
      response_text.length > MAX_TEXT_LENGTH
    ) {
      return json(
        { error: `response_text は${MAX_TEXT_LENGTH}文字以内の文字列にしてください` },
        400,
      );
    }
    if (
      selected_tags != null &&
      (!Array.isArray(selected_tags) ||
        selected_tags.length > MAX_TAGS ||
        selected_tags.some((t) => typeof t !== "string" || t.length > 30))
    ) {
      return json({ error: "selected_tags が不正です" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const embedding = await generateEmbedding(response_text);

    const { data: response, error: insertError } = await supabase
      .from("stimulus_responses")
      .insert({
        participant_id,
        stimulus_id,
        response_text,
        selected_tags: selected_tags ?? [],
        embedding,
      })
      .select("id")
      .single();
    if (insertError) throw insertError;

    const { data: threshold } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "match_threshold")
      .single();
    const matchThreshold = Number(threshold?.value ?? 0.8);

    const { data: candidates, error: rpcError } = await supabase.rpc(
      "find_resonance_candidates",
      { p_response_id: response.id },
    );
    if (rpcError) throw rpcError;

    const newMatches = [];
    for (const c of candidates ?? []) {
      if (c.resonance <= matchThreshold) continue;

      const [a, b] = [participant_id, c.other_participant_id].sort();
      const { data: existing } = await supabase
        .from("matches")
        .select("id")
        .eq("participant_id_a", a)
        .eq("participant_id_b", b)
        .maybeSingle();
      if (existing) continue;

      const { data: otherResponse } = await supabase
        .from("stimulus_responses")
        .select("response_text")
        .eq("participant_id", c.other_participant_id)
        .eq("stimulus_id", stimulus_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      const phrase = await generateReactionPhrase(
        response_text,
        otherResponse?.response_text ?? "",
      );

      const { data: match, error: matchError } = await supabase
        .from("matches")
        .insert({
          participant_id_a: a,
          participant_id_b: b,
          stimulus_id,
          score: Math.round(c.resonance * 10000) / 10000,
          reaction_phrase: phrase,
        })
        .select("id, score, reaction_phrase")
        .single();
      if (matchError) {
        // 同時投稿による一意制約違反はスキップ
        console.error("match insert error:", matchError);
        continue;
      }
      newMatches.push(match);
    }

    return json({ response_id: response.id, matches: newMatches });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
