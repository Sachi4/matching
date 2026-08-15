export type Participant = {
  id: string;
  nickname: string;
  created_at: string;
};

export type Tone = {
  id: string;
  label: string;
  sort_order: number;
};

export type Stimulus = {
  id: string;
  tone_id: string;
  image_url: string | null;
  is_active: boolean;
  stimulus_type: string;
  created_at: string;
};

export type HintWord = {
  id: string;
  tone_id: string;
  word: string;
  sort_order: number;
};

export type DiagnosisQuestion = {
  id: string;
  tone_id: string;
  prompt: string;
  text_a: string;
  text_b: string;
  axis: string;
  sort_order: number;
};

export type StimulusResponse = {
  id: string;
  participant_id: string;
  stimulus_id: string;
  hint_words_selected: string[];
  free_text: string;
  created_at: string;
};

export type DiagnosisAnswer = {
  id: string;
  participant_id: string;
  question_id: string;
  choice: "a" | "b";
  created_at: string;
};

export type Match = {
  id: string;
  participant_id_a: string;
  participant_id_b: string;
  score: number;
  decisive_tone_id: string | null;
  reaction_phrase: string | null;
  created_at: string;
};
