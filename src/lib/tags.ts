// 感想入力のヒントとなる形容詞チップ。色は集合アートの描画にも使う
export const FEELING_TAGS: { label: string; color: string }[] = [
  { label: "やわらかい", color: "#F5D5C8" },
  { label: "ざわめく", color: "#E86A5B" },
  { label: "つめたい", color: "#7FB6D9" },
  { label: "あたたかい", color: "#F2A65A" },
  { label: "ひろがる", color: "#9BD4C0" },
  { label: "しずか", color: "#8B9DC3" },
  { label: "はじける", color: "#F2D14E" },
  { label: "なつかしい", color: "#C9A87C" },
  { label: "ふしぎ", color: "#A78BC9" },
  { label: "ゆれる", color: "#7FC9A8" },
  { label: "とがった", color: "#D95970" },
  { label: "とけていく", color: "#C7B8E0" },
];

export const TAG_COLOR_MAP: Record<string, string> = Object.fromEntries(
  FEELING_TAGS.map((t) => [t.label, t.color]),
);
