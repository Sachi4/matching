// 感想の投稿を受け取るEdge Function。
// 参加者を待たせないため、感想は即座にinsertして返し、embedding生成と共鳴判定は
// バックグラウンド（EdgeRuntime.waitUntil）で行う。共鳴が生まれた場合は
// matches のRealtimeイベントとしてフロントに後から届く。
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  generateEmbedding,
  loadStimulusImageOrNull,
  responseText,
} from "../_shared/embedding.ts";

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

// バックグラウンド処理: embeddingを生成してinsert済みの行を更新し、そのまま共鳴判定まで走らせる
async function embedAndCheck(
  supabase: ReturnType<typeof createClient>,
  responseId: string,
  participantId: string,
  stimulusId: string,
  text: string,
): Promise<void> {
  try {
    const image = await loadStimulusImageOrNull(supabase, stimulusId);
    const embedding = await generateEmbedding(text, image);
    const { error } = await supabase
      .from("stimulus_responses")
      .update({ embedding })
      .eq("id", responseId);
    if (error) throw error;

    const res = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/check-resonance`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ participant_id: participantId }),
      },
    );
    if (!res.ok) {
      console.error("check-resonance error:", res.status, await res.text());
    }
  } catch (e) {
    console.error("background embedding failed:", e);
  }
}

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

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
    const text = responseText(words, free_text ?? "");
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

    // embeddingは後追いで埋める（集合アートはこのinsertのRealtimeで即座に反応する）
    const { data: response, error: insertError } = await supabase
      .from("stimulus_responses")
      .insert({
        participant_id,
        stimulus_id,
        hint_words_selected: words,
        free_text: (free_text ?? "").trim(),
        embedding: null,
      })
      .select("id")
      .single();
    if (insertError) throw insertError;

    const background = embedAndCheck(
      supabase,
      response.id,
      participant_id,
      stimulus_id,
      text,
    );
    if (typeof EdgeRuntime !== "undefined") {
      EdgeRuntime.waitUntil(background);
    } else {
      await background;
    }

    return json({ response_id: response.id, queued: true });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
