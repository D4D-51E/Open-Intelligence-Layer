const ALLOWED_PUBLIC_SOURCE_HOSTS = new Set([
  'celestrak.org',
  'gdeltproject.org',
  'news.google.com',
  'open-meteo.com',
  'openskynetwork.github.io',
  'ourairports.com',
  'www.gdeltproject.org',
]);

export function safeExternalUrl(url: string | undefined) {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return undefined;
    if (!ALLOWED_PUBLIC_SOURCE_HOSTS.has(parsed.hostname)) return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}
