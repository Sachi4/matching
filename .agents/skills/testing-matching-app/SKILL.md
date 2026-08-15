---
name: testing-matching-app
description: How to run and E2E-test the 運命の出会いを科学する app (Next.js 15 + local Supabase) including match-flow triggering and Japanese text input
---

# Testing the matching app locally

## Stack startup
1. `npx supabase@latest start` in the repo root (Docker required). Note the anon key from `npx supabase@latest status`.
2. After any migration change: `npx supabase@latest db reset` (re-applies migration + seed of 3 stimuli).
3. Serve edge functions with `npx supabase@latest functions serve` — recent CLI versions (≥2.114) reject a positional function name (`functions serve submit-response` fails), so serve all.
4. Create `.env.local`: `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` and `NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>`.
5. `npm run dev` → http://localhost:3000. If you see `Cannot find module './NNN.js'`, kill next dev, `rm -rf .next`, restart (stale cache).

## Key URLs
- App http://localhost:3000, Supabase API :54321, DB `postgresql://postgres:postgres@127.0.0.1:54322/postgres`, Studio :54323.
- DB queries: `docker exec supabase_db_matching psql -U postgres -d postgres -c "..."`.

## Triggering a match deterministically (fallback embedding, no OpenAI key)
- Score = 0.6*text_cosine + 0.4*type_closeness, threshold 0.8 (app_settings).
- Use two participants (2nd in incognito — identity is localStorage key `kyomei_participant`) with IDENTICAL free text, same tags, and the same diagnosis answers → score 1.0, match guaranteed. No need to lower match_threshold.
- Fallback reaction phrase = first 4 non-punctuation chars of each response_text joined by 「と」. Note response_text is `tags joined by 、` + `。` + free text, so tags come first.

## Japanese input in the GUI browser
Direct `type` of Japanese via the computer tool may produce no input. Workaround: `printf 'テキスト' | xclip -selection clipboard` (install xclip via apt) then Ctrl+V in the field.

## Gotchas
- RLS policies alone are not enough locally: tables need explicit GRANTs to anon/authenticated AND to service_role (edge function uses service_role). If inserts fail with 42501, check migration GRANT section.
- Realtime feed/canvas tests: keep participant A's /feed window visible side-by-side (wmctrl -e) while participant B submits in incognito; the match card and canvas blob must appear without reload.
