-- トーンのマスタ
insert into public.tones (label, sort_order) values
  ('高揚感', 1),
  ('悲しみ', 2),
  ('怒り', 3);

-- 刺激（各トーン1枚）。追加・削除はTable Editorから直接行う
insert into public.stimuli (tone_id, image_url, is_active, stimulus_type)
select t.id, v.image_url, true, 'image'
from (values
  ('高揚感', '/stimuli/01.svg'),
  ('悲しみ', '/stimuli/02.svg'),
  ('怒り', '/stimuli/03.svg')
) as v(label, image_url)
join public.tones t on t.label = v.label;

-- 感想入力のヒント語
insert into public.hint_words (tone_id, word, sort_order)
select t.id, v.word, v.sort_order
from (values
  ('高揚感', '弾む', 1),
  ('高揚感', '加速する', 2),
  ('高揚感', '光が広がる', 3),
  ('高揚感', '心が跳ねる', 4),
  ('高揚感', '前のめり', 5),
  ('高揚感', '突き抜ける', 6),
  ('悲しみ', '静かに沈む', 1),
  ('悲しみ', '雨のような', 2),
  ('悲しみ', '遠い記憶', 3),
  ('悲しみ', '余韻が残る', 4),
  ('悲しみ', '切ない', 5),
  ('悲しみ', '色が薄れる', 6),
  ('怒り', '尖る', 1),
  ('怒り', '燃える', 2),
  ('怒り', 'ざらつく', 3),
  ('怒り', '圧がかかる', 4),
  ('怒り', '渦巻く', 5),
  ('怒り', 'かき乱される', 6)
) as v(label, word, sort_order)
join public.tones t on t.label = v.label;

-- 診断質問（a寄り＝表出、b寄り＝内省）
insert into public.diagnosis_questions (tone_id, prompt, text_a, text_b, axis, sort_order)
select t.id, v.prompt, v.text_a, v.text_b, '表出/内省', v.sort_order
from (values
  ('高揚感', 1, '高揚感を感じたとき、まず表れるのは',
   '態度や表情に出る（言葉より先に）',
   '言葉にして伝えたくなる（考えてまとめてから）'),
  ('高揚感', 2, 'その高まりを誰かと共有したいと思ったら',
   'すぐに言葉にして伝えたい',
   'しばらく自分の中で味わってから伝えたい'),
  ('悲しみ', 1, '悲しみを感じたとき、心に浮かぶのは',
   '具体的な記憶や情景',
   '漠然とした感覚や色'),
  ('悲しみ', 2, 'その悲しみとどう向き合いたいか',
   '誰かにそばにいてほしい',
   '一人でゆっくり感じていたい'),
  ('怒り', 1, '怒りを感じたとき、あなたは',
   'すぐ言葉や態度に出る',
   '内側にこもってしまう'),
  ('怒り', 2, '怒りが収まるまでの時間は',
   'わりと短い（発散して切り替わる）',
   'わりと長い（しばらく引きずる）')
) as v(label, sort_order, prompt, text_a, text_b)
join public.tones t on t.label = v.label;
