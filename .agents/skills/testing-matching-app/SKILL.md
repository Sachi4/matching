---
name: testing-matching-app
description: How to run and E2E-test the 運命の出会いを科学する (共鳴/matching) app — local Supabase stack or the LIVE Supabase project, test-mode debug UI, realtime match/burst verification, constellation focus and Japanese text input
---

# Testing the matching app

Two ways to run it. **Prefer the LIVE Supabase project** when the task says the migration/edge functions are already
deployed there — it is much faster and matches what the user sees. Use the local Docker stack only for schema work.

## A. Running against the LIVE Supabase project (recommended)
1. Create `.env.local` in the repo root:
   - `NEXT_PUBLIC_SUPABASE_URL=<secret:org:NEXT_PUBLIC_SUPABASE_URL>`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY=<secret:org:NEXT_PUBLIC_SUPABASE_ANON_KEY>`
2. `npm run dev` → http://localhost:3000 (no Docker, no `supabase start`, edge functions already deployed).
3. Service-role CLI/REST work needs `NEXT_PUBLIC_SUPABASE_URL` + `secret:org:SUPABASE_SERVICE_ROLE_KEY`:
   - `node scripts/test-data.mjs <test-mode on|off|seed-pair|force-match|refresh-graph|cleanup>`
   - or plain REST, e.g. `curl "$URL/rest/v1/matches?select=id" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"`.
4. Restarting dev: a backgrounded `npm run dev` started from a short-lived shell can die. Use
   `cd <repo> && nohup npm run dev > /tmp/dev.log 2>&1 &`. If port 3000 seems taken by a zombie and Next silently
   moves to 3001, `pkill -f "next-server"; pkill -f "next dev"` first, then verify with
   `for p in /feed /admin/test /screen /respond; do curl -so /dev/null -w "$p:%{http_code}\n" localhost:3000$p; done`.
   After a restart, hard-reload open tabs (Ctrl+Shift+R) — a stale tab renders unstyled/broken.

## B. Local Docker stack (schema work only)
1. `npx supabase@latest start` (Docker). Anon key from `npx supabase@latest status`.
2. After a migration change: `npx supabase@latest db reset`.
3. `npx supabase@latest functions serve` (no positional function name on CLI ≥2.114).
4. `.env.local` → `http://127.0.0.1:54321` + local anon key. `npm run dev`.
   `Cannot find module './NNN.js'` → kill dev, `rm -rf .next`, restart.
- Supabase API :54321, DB `postgresql://postgres:postgres@127.0.0.1:54322/postgres`, Studio :54323.
- DB queries: `docker exec supabase_db_matching psql -U postgres -d postgres -c "..."`.

## Test mode / debug UI
- `app_settings.test_mode` (value 1 = ON) gates `/admin/test`; passphrase = `debug_config.token`, default `kyomei-debug`.
  Buttons stay disabled until the passphrase is entered; `test_mode: ON` then shows in green.
- 「ペアを投入する」(seed-pair) runs the REAL embedding pipeline: creates 2 participants **with**
  `stimulus_responses`, so it adds constellation stars. Match lands in ~5-10s.
- 「共鳴を発生させる」(force-match) inserts straight into `matches`: feed card + burst appear, but **no** stars,
  so the post-burst constellation zoom has nothing to focus on. Expected, not a bug.
- 「テストデータを削除」/`cleanup` deletes `is_test` participants and cascades matches/responses. Leave `test_mode` ON
  unless told otherwise; verify afterwards with `app_settings?key=eq.test_mode`.

## Creating a match that includes YOU (badge / feed-burst tests)
`force-match` never includes the localStorage participant. Insert directly with the service role:
`POST /rest/v1/matches {participant_id_a, participant_id_b, score, reaction_phrase}`.
**`matches_pair_order` check constraint**: `participant_id_a` must sort before `participant_id_b` (UUID order) or you get
HTTP 400 `23514`. There is also a uniqueness constraint per pair — reuse of a pair silently returns 400/409, so pick a
fresh partner each time. Local participant lives in localStorage key `kyomei_participant` (register a nickname at `/`).

## Burst overlay (ResonanceBurst) testing
- Mounts: `/feed` and `/respond` with `meId` (only bursts for matches involving you), `/admin/test` without `meId`
  (bursts for every match), `/screen` with `focusPath={null}`.
- Duration 5s, click anywhere dismisses. After dismissal the two dots are zoomed/highlighted in the constellation
  for 5s (`src/lib/resonanceFocus.ts` → sessionStorage + `resonance-focus` window event), pending queue capped (MAX_QUEUE=3): the visible burst is never interrupted,
  older *pending* ones are dropped.
- **Timing/screenshot cadence**: after firing N matches, stop touching the page and screenshot every ~2s for ~35s,
  recording which nickname pair the overlay names each frame. Count DISTINCT pairs to judge the cap; a ~6s gap between
  distinct pairs proves none was cut short. Cross-check that all N rows exist (`matches?select=id`) — the cap must drop
  animations, not data.
- To prove **click** dismissal (not the timer), keep two windows on the same match: click one within ~2s and screenshot
  immediately — the clicked window clears while the other still shows the burst.
- Venue screens must be silent: check `document.querySelectorAll('audio,video').length === 0` on `/screen` as supporting
  evidence, plus `grep -rn "audio|Audio" src/`.

## Two windows side by side (realtime tests)
The Chrome-for-Testing binary often ignores a separate `--new-window` launch. Instead focus the existing window and press
**Ctrl+N**, then type the URL. Tile with:
`DISPLAY=:0 wmctrl -l` then `DISPLAY=:0 wmctrl -i -r <id> -e 0,0,0,520,1180` (520px ≈ mobile width for /feed).
Note: the browser-console/CDP tool only attaches to ONE window (the first one) — to read console logs for a route open
that route in that window.

## Japanese input in the GUI browser
Direct `type` of Japanese may produce nothing. Use `printf 'テキスト' | DISPLAY=:0 xclip -selection clipboard` then Ctrl+V.
(`sudo apt-get install -y xclip wmctrl` if missing.)

## Triggering a match deterministically (fallback embedding, no OpenAI key)
- Score = cosine similarity of the response embeddings only, threshold `app_settings.match_threshold` (0.55).
- Two participants (2nd in incognito) with IDENTICAL free text and same tags → score 1.0.
- The diagnosis quiz no longer exists in `/respond`; `diagnosis_*` tables are unused.
- Fallback reaction phrase = first 4 non-punctuation chars of each response_text joined by 「と」.

## Gotchas
- RLS alone isn't enough locally: tables need GRANTs to anon/authenticated AND service_role (42501 → check migration).
- The carousel on `/feed` uses `snap-mandatory`; a small wheel delta snaps back. Use a large shift+wheel delta or drag.
- `/screen` labels can overlap when two matched stars sit very close together (cosmetic).
