// Client for /api/telegram — public Telegram-channel OSINT (strike/damage results only).
// Read-only, best-effort: any failure resolves to an empty list rather than throwing.
import type { TelegramLike } from './claimVerify';

export type TelegramPost = TelegramLike & {
  channel: string;
  postId: number;
};

type TelegramResponse = { ok: boolean; posts?: TelegramPost[] };

export async function fetchTelegramPosts(signal?: AbortSignal, baseUrl = ''): Promise<TelegramPost[]> {
  try {
    const response = await fetch(`${baseUrl}/api/telegram`, { signal });
    if (!response.ok) return [];
    const payload = await response.json() as TelegramResponse;
    if (!payload.ok) return [];
    return payload.posts ?? [];
  } catch {
    return [];
  }
}
