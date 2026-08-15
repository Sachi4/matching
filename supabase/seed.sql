-- デモ用の刺激（抽象画像3枚）。運営はこのテーブルにinsert/update/deleteするだけで自由に増減できる
insert into public.stimuli (stimulus_type, image_url, emotional_tone_label, is_active, sort_order) values
  ('image', '/stimuli/01.svg', 'ゆらぎ', true, 1),
  ('image', '/stimuli/02.svg', 'ざわめき', true, 2),
  ('image', '/stimuli/03.svg', 'しずけさ', true, 3);
