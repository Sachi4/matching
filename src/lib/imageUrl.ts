// DB由来の画像URLは相対パスか http(s) のみ許可する（javascript: 等の混入対策）
export function safeImageUrl(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return url;
    }
  } catch {
    // fallthrough
  }
  return null;
}
