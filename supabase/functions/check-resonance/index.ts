// 感想のembeddingが生成されたタイミングで共鳴判定を行うEdge Function
// 共鳴度は感想文embeddingの類似度のみ。閾値を超えたペアを matches にinsertし、
// decisive_tone を使って反応名を生成する
import { createClient } from "npm:@supabase/supabase-js@2";

// 本番ではALLOWED_ORIGINにフロントのオリジンを設定して呼び出し元を制限する
const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Claude APIで2つの感想文とトーンから詩的な短い「反応名」を生成。
// キー未設定時は2つの感想の断片を組み合わせる簡易フォールバック
async function generateReactionPhrase(
  toneLabel: string,
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
                `「${toneLabel}」をテーマにした同じ抽象画像を見た2人の感想です。\n` +
                `感想1:「${textA}」\n感想2:「${textB}」\n\n` +
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
  return fallbackPhrase(toneLabel, textA, textB);
}

function fallbackPhrase(
  toneLabel: string,
  textA: string,
  textB: string,
): string {
  const frag = (t: string) =>
    t.replace(/[、。！？\s,.!?]/g, "").slice(0, 4) || toneLabel;
  return `${frag(textA)}と${frag(textB)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const { participant_id } = await req.json();
    if (typeof participant_id !== "string" || !UUID_RE.test(participant_id)) {
      return json({ error: "participant_id が不正です" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: threshold } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "match_threshold")
      .single();
    const matchThreshold = Number(threshold?.value ?? 0.55);

    const { data: candidates, error: rpcError } = await supabase.rpc(
      "find_resonance_candidates",
      { p_participant_id: participant_id },
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

      // decisive_tone（感想文の類似度が最も高かったトーン）の感想文で反応名を生成
      let toneLabel = "";
      let textA = "";
      let textB = "";
      if (c.decisive_tone_id) {
        const [{ data: tone }, { data: texts }] = await Promise.all([
          supabase
            .from("tones")
            .select("label")
            .eq("id", c.decisive_tone_id)
            .single(),
          supabase
            .from("stimulus_responses")
            .select(
              "participant_id, hint_words_selected, free_text, created_at, stimuli!inner(tone_id)",
            )
            .in("participant_id", [a, b])
            .eq("stimuli.tone_id", c.decisive_tone_id)
            .order("created_at", { ascending: false }),
        ]);
        toneLabel = tone?.label ?? "";
        const textOf = (pid: string) => {
          const row = (texts ?? []).find((t) => t.participant_id === pid);
          if (!row) return "";
          return [
            (row.hint_words_selected ?? []).join("、"),
            (row.free_text ?? "").trim(),
          ]
            .filter(Boolean)
            .join("。");
        };
        textA = textOf(a);
        textB = textOf(b);
      }

      const phrase = await generateReactionPhrase(toneLabel, textA, textB);

      const { data: match, error: matchError } = await supabase
        .from("matches")
        .insert({
          participant_id_a: a,
          participant_id_b: b,
          score: Math.round(c.resonance * 10000) / 10000,
          decisive_tone_id: c.decisive_tone_id,
          reaction_phrase: phrase,
        })
        .select("id, score, reaction_phrase, decisive_tone_id")
        .single();
      if (matchError) {
        // 同時投稿による一意制約違反はスキップ
        console.error("match insert error:", matchError);
        continue;
      }
      newMatches.push(match);
    }

    return json({ matches: newMatches });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
