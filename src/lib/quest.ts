// 共鳴後の探索（Resonance Quest）の語彙と設問。
// 3感情 × 3レイヤーで感情の解像度を上げていく。
// L1 輪郭（体感チップ） → L2 温度と速度（2軸） → L3 出どころ（1文）

export type EmotionKey = "elation" | "sadness" | "anger";

export type QuestAxis = {
  label: string;
  negative: string;
  positive: string;
};

export type EmotionDefinition = {
  key: EmotionKey;
  label: string;
  lead: string;
  palette: [string, string];
  chips: { label: string; color: string }[];
  axisX: QuestAxis;
  axisY: QuestAxis;
  l3Question: string;
  l3Placeholder: string;
};

export const EMOTIONS: Record<EmotionKey, EmotionDefinition> = {
  elation: {
    key: "elation",
    label: "高揚感",
    lead: "上がっていく感覚を、二人で細かくしていく",
    palette: ["#F2D14E", "#F2A65A"],
    chips: [
      { label: "胸が浮く", color: "#F2D14E" },
      { label: "頭が冴える", color: "#9BD4C0" },
      { label: "足が先に動く", color: "#F2A65A" },
      { label: "声が出る", color: "#E86A5B" },
      { label: "視界が広がる", color: "#7FB6D9" },
      { label: "手が落ち着かない", color: "#C9A87C" },
    ],
    axisX: { label: "温度", negative: "澄んだ", positive: "熱い" },
    axisY: { label: "速度", negative: "じわじわ", positive: "爆発" },
    l3Question: "最後にこれを感じたのは、どんなときでしたか？",
    l3Placeholder: "例：終電を降りて、誰もいない駅のホームに立ったとき",
  },
  sadness: {
    key: "sadness",
    label: "悲しみ",
    lead: "沈んでいく感覚を、二人で細かくしていく",
    palette: ["#7FB6D9", "#8B9DC3"],
    chips: [
      { label: "喉がつまる", color: "#8B9DC3" },
      { label: "目の奥が熱い", color: "#D95970" },
      { label: "手が重い", color: "#7FB6D9" },
      { label: "体が空になる", color: "#C7B8E0" },
      { label: "音が遠くなる", color: "#9BD4C0" },
      { label: "息が浅くなる", color: "#F5D5C8" },
    ],
    axisX: { label: "温度", negative: "冷たい", positive: "あたたかい" },
    axisY: { label: "訪れ方", negative: "ずっとある", positive: "突然くる" },
    l3Question: "その悲しみは、誰に向いていましたか？",
    l3Placeholder: "例：たぶん、置いていった昔の自分に向いていた",
  },
  anger: {
    key: "anger",
    label: "怒り",
    lead: "こみあげる感覚を、二人で細かくしていく",
    palette: ["#E86A5B", "#D95970"],
    chips: [
      { label: "顎に力が入る", color: "#D95970" },
      { label: "腹が熱い", color: "#E86A5B" },
      { label: "手が冷たくなる", color: "#7FB6D9" },
      { label: "声が低くなる", color: "#8B9DC3" },
      { label: "視野が狭くなる", color: "#A78BC9" },
      { label: "呼吸が速くなる", color: "#F2A65A" },
    ],
    axisX: { label: "温度", negative: "氷", positive: "沸騰" },
    axisY: { label: "持続", negative: "くすぶる", positive: "瞬間" },
    l3Question: "その怒りで、本当は何を守りたかったのですか？",
    l3Placeholder: "例：黙っていた人たちの、言えなかった時間",
  },
};

export const EMOTION_ORDER: EmotionKey[] = ["elation", "sadness", "anger"];

export const LAYER_TITLES: Record<number, { title: string; hint: string }> = {
  1: { title: "L1 輪郭", hint: "体のどこで、どう動くか" },
  2: { title: "L2 温度と速度", hint: "その感情の質を、2つの軸に置く" },
  3: { title: "L3 出どころ", hint: "ひとつだけ、言葉にする" },
};

// -1〜1 の2軸を 0〜100% の座標に変換（プロット表示用）
export function axisToPercent(value: number): number {
  return ((value + 1) / 2) * 100;
}
