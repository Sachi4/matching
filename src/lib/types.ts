export type Participant = {
  id: string;
  nickname: string;
  created_at: string;
};

export type Stimulus = {
  id: string;
  stimulus_type: string;
  image_url: string | null;
  emotional_tone_label: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
};

export type StimulusResponse = {
  id: string;
  participant_id: string;
  stimulus_id: string;
  response_text: string;
  selected_tags: string[];
  created_at: string;
};

export type DiagnosisScore = {
  id: string;
  participant_id: string;
  type_key: string;
  type_name: string;
  axis_e: number;
  axis_n: number;
  axis_i: number;
  created_at: string;
};

export type Match = {
  id: string;
  participant_id_a: string;
  participant_id_b: string;
  stimulus_id: string | null;
  score: number;
  reaction_phrase: string | null;
  created_at: string;
};
