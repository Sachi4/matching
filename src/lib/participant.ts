// 参加者情報はlocalStorageに保持する（認証なし・端末単位）
const PARTICIPANT_KEY = "kyomei_participant";
const DIAGNOSIS_KEY = "kyomei_diagnosis";

export type StoredParticipant = { id: string; nickname: string };
export type StoredDiagnosis = {
  typeKey: string;
  typeName: string;
  tagline: string;
  palette: [string, string, string];
};

export function getStoredParticipant(): StoredParticipant | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(PARTICIPANT_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function storeParticipant(p: StoredParticipant) {
  localStorage.setItem(PARTICIPANT_KEY, JSON.stringify(p));
}

export function getStoredDiagnosis(): StoredDiagnosis | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(DIAGNOSIS_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function storeDiagnosis(d: StoredDiagnosis) {
  localStorage.setItem(DIAGNOSIS_KEY, JSON.stringify(d));
}
