import fs from 'node:fs/promises';
import path from 'node:path';

const outPath = path.resolve('public/data/briefing-cache.json');
const defaultBriefingBullets = [
  'Use public API data and cached public snapshots only; do not fill missing layers with synthetic values.',
  'Every analytic claim should cite the source layer that produced it.',
  'Treat OSINT/news signals as correlation cues until independently verified.',
  'No target designation, strike recommendation, or automated engagement logic is allowed.',
];

async function readEnv() {
  try {
    const raw = await fs.readFile(path.resolve('.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // .env is optional.
  }
}

async function generateWithOpenAI() {
  if (!process.env.OPENAI_API_KEY) return null;
  const prompt = `Create a concise Air ISR analyst-support briefing disclaimer for a hackathon prototype. Emphasize public API/cache-only data, citation requirements, analyst review, empty layers when APIs fail, and no targeting or strike automation. Return 4 bullets.`;
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      input: prompt,
      max_output_tokens: 240,
    }),
  });
  if (!response.ok) throw new Error(`OpenAI request failed ${response.status}`);
  const json = await response.json();
  return json.output_text || null;
}

async function main() {
  await readEnv();
  let text = null;
  try {
    text = await generateWithOpenAI();
  } catch (error) {
    console.warn(`OpenAI briefing generation skipped: ${error.message}`);
  }
  const payload = {
    generatedAt: new Date().toISOString(),
    safety: 'Use public API/cache-only data; no synthetic fill, target designation, or strike automation.',
    briefingBullets: text
      ? text.split(/\n+/).map((line) => line.replace(/^[-*\d.\s]+/, '').trim()).filter(Boolean).slice(0, 4)
      : defaultBriefingBullets,
  };
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Wrote ${outPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
