// 探索（Resonance Quest）の1レイヤー分の回答を受け取り、
// 両者そろったら結果を計算し、L3完了時は「共有語」を生成して保存するEdge Function
import { createClient } from "npm:@supabase/supabase-js@2";

const EMBEDDING_DIM = 1536;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// submit-response と同じ方針: キー未設定時はローカルの決定的擬似embeddingにフォールバック
async function generateEmbedding(text: string): Promise<number[]> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (apiKey) {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
    });
    if (!res.ok) {
      throw new Error(`embedding API error: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    return data.data[0].embedding as number[];
  }
  return localEmbedding(text);
}

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

const EMOTION_LABELS: Record<string, string> = {
  elation: "高揚感",
  sadness: "悲しみ",
  anger: "怒り",
};

type TurnRow = {
  participant_id: string;
  layer: number;
  chips: string[];
  axis_x: number | null;
  axis_y: number | null;
  text_answer: string | null;
};

function describeSide(turns: TurnRow[]): string {
  const l1 = turns.find((t) => t.layer === 1);
  const l2 = turns.find((t) => t.layer === 2);
  const l3 = turns.find((t) => t.layer === 3);
  return [
    l1?.chips?.length ? `体感: ${l1.chips.join("、")}` : null,
    l2 ? `温度 ${Number(l2.axis_x).toFixed(2)} / 速度 ${Number(l2.axis_y).toFixed(2)}（-1〜1）` : null,
    l3?.text_answer ? `出どころ: ${l3.text_answer}` : null,
  ]
    .filter(Boolean)
    .join(" / ");
}

// Claudeで、二人の3レイヤー分の回答から「共有語」（二人だけの造語・短句）を生成する。
// キー未設定時は両者の記述の断片を組み合わせる簡易フォールバック
async function generateSharedTerm(
  emotion: string,
  sideA: string,
  sideB: string,
  resonance: number,
  contrast: number,
): Promise<{ term: string; description: string }> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  const emotionLabel = EMOTION_LABELS[emotion] ?? emotion;
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
          max_tokens: 200,
          messages: [
            {
              role: "user",
              content:
                `2人が「${emotionLabel}」という感情を3段階で掘り下げました。\n` +
                `Aさん: ${sideA}\nBさん: ${sideB}\n` +
                `共鳴度 ${(resonance * 100).toFixed(0)}% / 対比 ${(contrast * 100).toFixed(0)}%\n\n` +
                `この2人だけの「${emotionLabel}」を名づける短い日本語の造語（4〜10文字）と、` +
                `その語が2人の重なりと違いのどこを指すのかの説明（40文字以内）を作ってください。\n` +
                `似ている点だけでなく、違っている点も名前に含めてください。\n` +
                `出力は次の1行のJSONのみ:{"term":"...","description":"..."}`,
            },
          ],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const raw = (data.content?.[0]?.text ?? "").trim();
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (parsed.term) {
            return {
              term: String(parsed.term).slice(0, 20),
              description: String(parsed.description ?? "").slice(0, 120),
            };
          }
        }
      } else {
        console.error("Claude API error:", res.status, await res.text());
      }
    } catch (e) {
      console.error("Claude API call failed:", e);
    }
  }
  return fallbackTerm(emotionLabel, sideA, sideB);
}

// 語の途中で切れて日本語が崩れないよう、句読点か助詞の境目で切る
function clause(text: string): string {
  const head = text.split(/[、。！？\n]/)[0].trim();
  if (head.length <= 6) return head;
  const window = head.slice(0, 9);
  const boundary = Math.max(
    ...[..."はがをにでとへのも"].map((p) => window.lastIndexOf(p)),
  );
  return boundary >= 2 ? head.slice(0, boundary) : head.slice(0, 6);
}

function fallbackTerm(
  emotionLabel: string,
  sideA: string,
  sideB: string,
): { term: string; description: string } {
  const frag = (t: string) => clause(t.split("出どころ: ")[1] ?? t) || "ゆらぎ";
  return {
    term: `${frag(sideA)}と${frag(sideB)}`,
    description: `二人の${emotionLabel}が重なったところ`,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const { session_id, participant_id, layer, chips, axis_x, axis_y, text_answer } =
      await req.json();
    if (!session_id || !participant_id || !layer) {
      return json(
        { error: "session_id, participant_id, layer は必須です" },
        400,
      );
    }
    if (![1, 2, 3].includes(Number(layer))) {
      return json({ error: "layer は 1〜3 です" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: session, error: sessionError } = await supabase
      .from("quest_sessions")
      .select("id, match_id, emotion, layer, status")
      .eq("id", session_id)
      .single();
    if (sessionError) throw sessionError;

    const { data: match, error: matchError } = await supabase
      .from("matches")
      .select("participant_id_a, participant_id_b")
      .eq("id", session.match_id)
      .single();
    if (matchError) throw matchError;
    if (
      participant_id !== match.participant_id_a &&
      participant_id !== match.participant_id_b
    ) {
      return json({ error: "このセッションの参加者ではありません" }, 403);
    }

    const embedding =
      Number(layer) === 3 && text_answer
        ? await generateEmbedding(String(text_answer))
        : null;

    const { data: turn, error: upsertError } = await supabase
      .from("quest_turns")
      .upsert(
        {
          session_id,
          participant_id,
          layer: Number(layer),
          chips: chips ?? [],
          axis_x: axis_x ?? null,
          axis_y: axis_y ?? null,
          text_answer: text_answer ?? null,
        },
        { onConflict: "session_id,participant_id,layer" },
      )
      .select("id")
      .single();
    if (upsertError) throw upsertError;

    if (embedding) {
      const { error: embeddingError } = await supabase
        .from("quest_turn_embeddings")
        .upsert({ turn_id: turn.id, embedding }, { onConflict: "turn_id" });
      if (embeddingError) throw embeddingError;
    }

    const { data: turns, error: turnsError } = await supabase
      .from("quest_turns")
      .select("participant_id, layer, chips, axis_x, axis_y, text_answer")
      .eq("session_id", session_id);
    if (turnsError) throw turnsError;

    const layerTurns = (turns ?? []).filter((t) => t.layer === Number(layer));
    const bothReady = new Set(layerTurns.map((t) => t.participant_id)).size >= 2;

    const { data: resultRows, error: resultError } = await supabase.rpc(
      "compute_quest_result",
      { p_session_id: session_id },
    );
    if (resultError) throw resultError;
    const result = resultRows?.[0] ?? null;

    let sharedTerm = null;
    // L3が両者そろった時点で共有語を生成（既に生成済みならそれを返す）
    if (bothReady && Number(layer) === 3 && result) {
      const { data: existing } = await supabase
        .from("quest_shared_terms")
        .select("*")
        .eq("session_id", session_id)
        .maybeSingle();
      if (existing) {
        sharedTerm = existing;
      } else {
        const sideA = describeSide(
          (turns ?? []).filter((t) => t.participant_id === match.participant_id_a),
        );
        const sideB = describeSide(
          (turns ?? []).filter((t) => t.participant_id === match.participant_id_b),
        );
        const generated = await generateSharedTerm(
          session.emotion,
          sideA,
          sideB,
          Number(result.resonance),
          Number(result.contrast),
        );
        const { data: inserted, error: insertError } = await supabase
          .from("quest_shared_terms")
          .insert({
            session_id,
            match_id: session.match_id,
            emotion: session.emotion,
            term: generated.term,
            description: generated.description,
            resonance: Math.round(Number(result.resonance) * 10000) / 10000,
            contrast: Math.round(Number(result.contrast) * 10000) / 10000,
            resolution: Number(result.resolution),
          })
          .select("*")
          .single();
        if (insertError) {
          // 同時送信による一意制約違反は既存行を読み直す
          console.error("shared term insert error:", insertError);
          const { data: retry } = await supabase
            .from("quest_shared_terms")
            .select("*")
            .eq("session_id", session_id)
            .maybeSingle();
          sharedTerm = retry;
        } else {
          sharedTerm = inserted;
        }
      }
      await supabase
        .from("quest_sessions")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", session_id)
        .neq("status", "completed");
    }

    return json({ both_ready: bothReady, result, shared_term: sharedTerm });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
