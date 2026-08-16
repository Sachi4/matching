// バースト演出のあと、共鳴マップで該当の2人にズーム・ハイライトするための合図。
// 演出とマップが別ページにあることもあるので、sessionStorage とイベントの両方で受け渡す。
export type ResonanceFocus = {
  a: string;
  b: string;
  /** 合図を出した時刻（ミリ秒）。古い合図は無視する */
  at: number;
};

const KEY = "resonance-focus";
export const FOCUS_EVENT = "resonance-focus";
/** ズーム表示を続ける時間。これを過ぎたら通常の全体表示に戻す */
export const FOCUS_DURATION = 5000;

export function requestResonanceFocus(a: string, b: string): void {
  if (typeof window === "undefined") return;
  const focus: ResonanceFocus = { a, b, at: Date.now() };
  sessionStorage.setItem(KEY, JSON.stringify(focus));
  window.dispatchEvent(new CustomEvent<ResonanceFocus>(FOCUS_EVENT, { detail: focus }));
}

export function readResonanceFocus(): ResonanceFocus | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const focus = JSON.parse(raw) as ResonanceFocus;
    if (Date.now() - focus.at > FOCUS_DURATION) return null;
    return focus;
  } catch {
    return null;
  }
}
