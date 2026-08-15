// 簡易感性診断（6問・E/N/I軸・8タイプ）
// SENSE Collectiveの「3軸スコアリング × 8タイプ」という枠組みと世界観のトーンだけを継承し、
// 質問文・タイプ名はこの体験（画像を見る）用に新規作成したもの

export type AxisWeights = { E: number; N: number; I: number };

export type DiagnosisQuestion = {
  id: string;
  text: string;
  options: { key: string; label: string; weights: AxisWeights }[];
};

// E軸: +ひらく（感じたことが外へ向かう） / −たたずむ（内に留めて味わう）
// N軸: +ゆらぎ（細部・気配に反応する） / −かたち（全体の構図・強さに反応する）
// I軸: +ひらめき（直感で受け取る） / −ふかよみ（意味を考えて受け取る）
export const DIAGNOSIS_QUESTIONS: DiagnosisQuestion[] = [
  {
    id: "Q1",
    text: "画像がパッと映し出された瞬間、あなたの中で最初に起きることは？",
    options: [
      { key: "A", label: "「わあ」と声が出そうになる", weights: { E: 2, N: 0, I: 1 } },
      { key: "B", label: "じっと黙って全体を眺める", weights: { E: -2, N: 0, I: 0 } },
      { key: "C", label: "細かい部分に目が吸い寄せられる", weights: { E: -1, N: 2, I: 0 } },
      { key: "D", label: "「これは何だろう」と考え始める", weights: { E: -1, N: 0, I: -2 } },
    ],
  },
  {
    id: "Q2",
    text: "抽象的な絵を見るとき、心が動くのはどんなとき？",
    options: [
      { key: "A", label: "色と色の境目のにじみに気づいたとき", weights: { E: 0, N: 2, I: 1 } },
      { key: "B", label: "画面全体の勢いや迫力を感じたとき", weights: { E: 1, N: -2, I: 1 } },
      { key: "C", label: "自分なりの解釈がひらめいたとき", weights: { E: 0, N: 0, I: -2 } },
      { key: "D", label: "理由もなく懐かしい気持ちになったとき", weights: { E: -1, N: 1, I: 2 } },
    ],
  },
  {
    id: "Q3",
    text: "感じたことを言葉にするなら、あなたに近いのは？",
    options: [
      { key: "A", label: "思いついたそばから口に出したい", weights: { E: 2, N: 0, I: 1 } },
      { key: "B", label: "ぴったりの言葉が見つかるまで待ちたい", weights: { E: -2, N: 1, I: -1 } },
      { key: "C", label: "言葉より先に、比喩やイメージが浮かぶ", weights: { E: 0, N: 1, I: 2 } },
      { key: "D", label: "なぜそう感じたのか、理由から説明したい", weights: { E: 0, N: -1, I: -2 } },
    ],
  },
  {
    id: "Q4",
    text: "同じ画像を見た人の感想を聞くとき、あなたは？",
    options: [
      { key: "A", label: "「わかる！」とすぐ盛り上がりたい", weights: { E: 2, N: 0, I: 1 } },
      { key: "B", label: "自分と違う見方をじっくり味わいたい", weights: { E: -1, N: 1, I: -1 } },
      { key: "C", label: "違いがどこから来るのか分析したくなる", weights: { E: -1, N: 0, I: -2 } },
      { key: "D", label: "人の感想で自分の感じ方が変わるのが楽しい", weights: { E: 1, N: 1, I: 1 } },
    ],
  },
  {
    id: "Q5",
    text: "心に残る画像は、どんな画像？",
    options: [
      { key: "A", label: "一目で圧倒される、強い画像", weights: { E: 1, N: -2, I: 1 } },
      { key: "B", label: "見るたびに違う表情を見せる、静かな画像", weights: { E: -1, N: 2, I: 0 } },
      { key: "C", label: "意味を考え続けてしまう、謎めいた画像", weights: { E: -1, N: 0, I: -2 } },
      { key: "D", label: "気分がそのまま持っていかれる、感情的な画像", weights: { E: 1, N: 1, I: 2 } },
    ],
  },
  {
    id: "Q6",
    text: "もしこの画像の中に入れるなら、あなたは何をする？",
    options: [
      { key: "A", label: "走り回って全部に触れてみる", weights: { E: 2, N: -1, I: 1 } },
      { key: "B", label: "いちばん静かな場所を探して座る", weights: { E: -2, N: 1, I: 0 } },
      { key: "C", label: "この世界の仕組みを調べてみる", weights: { E: -1, N: 0, I: -2 } },
      { key: "D", label: "空気の匂いや温度をたしかめる", weights: { E: 0, N: 2, I: 1 } },
    ],
  },
];

export type SenseType = {
  key: string;
  name: string;
  tagline: string;
  palette: [string, string, string];
};

// タイプキー: [E軸 O=ひらく/C=たたずむ][N軸 Y=ゆらぎ/K=かたち][I軸 H=ひらめき/F=ふかよみ]
export const SENSE_TYPES: Record<string, SenseType> = {
  OYH: {
    key: "OYH",
    name: "プリズムミスト",
    tagline: "光の粒をつかまえて、そのまま誰かに手渡す人",
    palette: ["#C7B8E0", "#F5D5C8", "#9BD4C0"],
  },
  OYF: {
    key: "OYF",
    name: "ステンドグラス",
    tagline: "細部の輝きを、物語として組み上げる人",
    palette: ["#A78BC9", "#F2D14E", "#7FB6D9"],
  },
  OKH: {
    key: "OKH",
    name: "サンフレア",
    tagline: "画面の熱を真っ先に浴びて、場を明るくする人",
    palette: ["#F2A65A", "#E86A5B", "#F2D14E"],
  },
  OKF: {
    key: "OKF",
    name: "テラコッタ",
    tagline: "大きな構図を読み解き、言葉で場を導く人",
    palette: ["#C9A87C", "#E86A5B", "#8B9DC3"],
  },
  CYH: {
    key: "CYH",
    name: "ムーンプール",
    tagline: "水面のゆらぎを、静かに全身で受けとめる人",
    palette: ["#8B9DC3", "#C7B8E0", "#7FC9A8"],
  },
  CYF: {
    key: "CYF",
    name: "アイスクォーツ",
    tagline: "細部の気配を、時間をかけて結晶にする人",
    palette: ["#7FB6D9", "#C7B8E0", "#F5D5C8"],
  },
  CKH: {
    key: "CKH",
    name: "インディゴナイト",
    tagline: "夜空の全体を、直感でまるごと感じる人",
    palette: ["#3F4E7A", "#8B9DC3", "#A78BC9"],
  },
  CKF: {
    key: "CKF",
    name: "ボタニカルインク",
    tagline: "静けさの中で、意味の根を深く張る人",
    palette: ["#5A7A5C", "#9BD4C0", "#C9A87C"],
  },
};

export type DiagnosisResult = {
  typeKey: string;
  typeName: string;
  tagline: string;
  palette: [string, string, string];
  axisE: number;
  axisN: number;
  axisI: number;
};

export function scoreDiagnosis(
  answers: Record<string, string>,
): DiagnosisResult {
  let e = 0;
  let n = 0;
  let i = 0;
  for (const q of DIAGNOSIS_QUESTIONS) {
    const key = answers[q.id];
    const opt = q.options.find((o) => o.key === key);
    if (!opt) continue;
    e += opt.weights.E;
    n += opt.weights.N;
    i += opt.weights.I;
  }
  const typeKey =
    (e >= 0 ? "O" : "C") + (n >= 0 ? "Y" : "K") + (i >= 0 ? "H" : "F");
  const t = SENSE_TYPES[typeKey];
  return {
    typeKey,
    typeName: t.name,
    tagline: t.tagline,
    palette: t.palette,
    axisE: e,
    axisN: n,
    axisI: i,
  };
}
