// 星座UI用の共鳴グラフ。座標計算のもとになる類似度はバックエンド（refresh_resonance_graph）が
// 計算してキャッシュし、フロントはそれを受け取ってレイアウトするだけにしている。
export type GraphNode = {
  id: string;
  nickname: string;
  is_test: boolean;
  response_count: number;
  expression_rate: number | null;
};

export type GraphEdge = {
  a: string;
  b: string;
  text_similarity: number;
  diagnosis_closeness: number;
  resonance: number;
  shared_stimuli: number;
  matched: boolean;
  reaction_phrase: string | null;
};

export type ResonanceGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  match_threshold: number;
  generated_at: string;
};

export const EMPTY_GRAPH: ResonanceGraph = {
  nodes: [],
  edges: [],
  match_threshold: 0.9,
  generated_at: "",
};
