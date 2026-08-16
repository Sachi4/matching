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

export type QuestSession = {
  id: string;
  match_id: string;
  emotion: string;
  layer: number;
  status: "active" | "completed";
  created_at: string;
  completed_at: string | null;
};

export type QuestTurn = {
  id: string;
  session_id: string;
  participant_id: string;
  layer: number;
  chips: string[];
  axis_x: number | null;
  axis_y: number | null;
  text_answer: string | null;
  created_at: string;
};

export type QuestResult = {
  l1_overlap: number | null;
  l2_distance: number | null;
  text_similarity: number | null;
  resonance: number;
  contrast: number;
  resolution: number;
};

export type QuestSharedTerm = {
  id: string;
  session_id: string;
  match_id: string;
  emotion: string;
  term: string;
  description: string | null;
  resonance: number;
  contrast: number;
  resolution: number;
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
