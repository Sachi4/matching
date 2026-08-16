// 既存の感想のembeddingを作り直すEdge Function。
// embeddingモデルを切り替えると古いベクトルと新しいベクトルが同じ空間に無く、
// 共鳴度が意味を成さなくなるため、切り替え時に全件を作り直すために使う。
// service_role キーでのみ呼べる（Authorizationヘッダの検証はSupabase側が行う）。
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  generateEmbedding,
  loadStimulusImageOrNull,
  responseText,
} from "../_shared/embedding.ts";

const DEFAULT_LIMIT = 200;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Number(body.limit ?? DEFAULT_LIMIT), 1000);
    // only_missing: embeddingがまだ無い行だけを対象にする（既定は全件作り直し）
    const onlyMissing = body.only_missing === true;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let query = supabase
      .from("stimulus_responses")
      .select("id, stimulus_id, hint_words_selected, free_text")
      .order("created_at")
      .limit(limit);
    if (onlyMissing) query = query.is("embedding", null);
    const { data: rows, error } = await query;
    if (error) throw error;

    let updated = 0;
    const failed: string[] = [];
    for (const row of rows ?? []) {
      const text = responseText(row.hint_words_selected, row.free_text);
      if (!text) continue;
      try {
        const image = await loadStimulusImageOrNull(supabase, row.stimulus_id);
        const embedding = await generateEmbedding(text, image);
        const { error: updateError } = await supabase
          .from("stimulus_responses")
          .update({ embedding })
          .eq("id", row.id);
        if (updateError) throw updateError;
        updated++;
      } catch (e) {
        console.error("reembed failed:", row.id, e);
        failed.push(row.id);
      }
    }

    // 距離はembeddingから計算されるので、グラフも作り直す
    const { error: refreshError } = await supabase.rpc(
      "refresh_resonance_graph",
    );
    if (refreshError) throw refreshError;

    return json({ total: rows?.length ?? 0, updated, failed });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
