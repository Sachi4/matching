// 共鳴マップ用の共鳴グラフ。座標計算のもとになる類似度はバックエンド（refresh_resonance_graph）が
// 計算してキャッシュし、フロントはそれを受け取ってレイアウトするだけにしている。
export type GraphNode = {
  id: string;
  nickname: string;
  is_test: boolean;
  response_count: number;
  // トーンごとの寄り（合計1）。3感情のハブの重心をとって配置に使う
  tone_weights?: Record<string, number>;
  dominant_tone_id?: string | null;
};

export type GraphTone = {
  id: string;
  label: string;
  sort_order: number;
};

export type GraphEdge = {
  a: string;
  b: string;
  text_similarity: number;
  resonance: number;
  // 全ペアの中での相対的な近さ（0〜1）。embeddingモデルによって類似度の絶対値の
  // レンジが変わるため、配置にはこちらを使う（古いキャッシュには無いのでoptional）
  proximity?: number;
  shared_stimuli: number;
  matched: boolean;
  reaction_phrase: string | null;
};

export type ResonanceGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  // 感情のハブ（高揚感・悲しみ・怒り）。古いキャッシュには無いのでoptional
  tones?: GraphTone[];
  match_threshold: number;
  generated_at: string;
};

export const EMPTY_GRAPH: ResonanceGraph = {
  nodes: [],
  edges: [],
  tones: [],
  match_threshold: 0.55,
  generated_at: "",
};
