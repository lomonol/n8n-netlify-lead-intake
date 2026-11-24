// Serverless function: validates the quote form, then forwards the lead to an n8n webhook
// with a shared-secret header. The browser never sees the webhook URL or the token.
import { validateLead } from '../../lib/lead.mjs';

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export default async (req) => {
  if (req.method !== 'POST') return json(405, { ok: false, error: 'Use POST.' });

  let input;
  try {
    input = await req.json();
  } catch {
    return json(400, { ok: false, error: 'Body must be JSON.' });
  }

  const result = validateLead(input);
  if (result.spam) return json(200, { ok: true, status: 'received' }); // honeypot: drop quietly
  if (!result.ok) return json(422, { ok: false, errors: result.errors });

  const url = process.env.N8N_WEBHOOK_URL;
  const token = process.env.N8N_INTAKE_TOKEN;
  if (!url || !token) return json(500, { ok: false, error: 'Intake is not configured.' });

  const payload = {
    ...result.lead,
    source: 'netlify-quote-form',
    submitted_at: new Date().toISOString(),
    page: req.headers.get('referer') || null,
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-intake-token': token, 'user-agent': 'netlify-lead-intake/1.0' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('n8n rejected lead', res.status, data);
      return json(502, { ok: false, error: 'We could not save your request. Please call us instead.' });
    }
    return json(200, { ok: true, status: data.status || 'received', lead_id: data.lead_id || null });
  } catch (err) {
    console.error('n8n unreachable', err.name, err.message);
    return json(504, { ok: false, error: 'We could not save your request. Please call us instead.' });
  }
};

export const config = { path: '/api/quote' };
