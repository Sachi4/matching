// 参加者情報はlocalStorageに保持する（認証なし・端末単位）
const PARTICIPANT_KEY = "kyomei_participant";

export type StoredParticipant = { id: string; nickname: string };

export function getStoredParticipant(): StoredParticipant | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(PARTICIPANT_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function storeParticipant(p: StoredParticipant) {
  localStorage.setItem(PARTICIPANT_KEY, JSON.stringify(p));
}
