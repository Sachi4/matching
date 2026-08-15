// トーンごとの色。集合アートと共鳴カードのグラデーションに使う
export const TONE_PALETTES: Record<string, string[]> = {
  高揚感: ["#F2D14E", "#F2A65A", "#E86A5B"],
  悲しみ: ["#7FB6D9", "#8B9DC3", "#C7B8E0"],
  怒り: ["#D95970", "#E86A5B", "#8C2F44"],
};

export const FALLBACK_PALETTE = ["#A78BC9", "#7FB6D9", "#F5D5C8"];

export function tonePalette(label: string | null | undefined): string[] {
  return (label && TONE_PALETTES[label]) || FALLBACK_PALETTE;
}
