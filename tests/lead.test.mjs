import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLead, normalizePhone } from '../lib/lead.mjs';
import handler from '../netlify/functions/submit-lead.mjs';

const good = { name: 'Test Lead 01', phone: '(555) 201-0101', zip: '60614', service: 'ac-repair', email: 'TEST01@example.com' };

test('phone normalisation', () => {
  assert.equal(normalizePhone('555-201-0101'), '+15552010101');
  assert.equal(normalizePhone('1 (555) 201 0101'), '+15552010101');
  assert.equal(normalizePhone('12345'), null);
  assert.equal(normalizePhone('055-201-0101'), null);
});

test('valid lead is normalised with a dedupe key', () => {
  const r = validateLead(good);
  assert.equal(r.ok, true);
  assert.equal(r.lead.email, 'test01@example.com');
  assert.equal(r.lead.preferred_time, 'any');
  assert.equal(r.lead.dedupe_key, '+15552010101|test01@example.com');
});

test('missing and bad fields are reported per field', () => {
  const r = validateLead({ name: 'A', phone: '12', zip: 'abc', service: 'roofing', email: 'nope' });
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.errors).sort(), ['email', 'name', 'phone', 'service', 'zip']);
});

test('honeypot marks spam', () => {
  assert.deepEqual(validateLead({ ...good, company_website: 'http://spam' }), { ok: true, spam: true });
});

const post = (body) => new Request('http://localhost/api/quote', { method: 'POST', body: JSON.stringify(body) });

test('function: rejects GET and bad JSON', async () => {
  assert.equal((await handler(new Request('http://localhost/api/quote'))).status, 405);
  const bad = new Request('http://localhost/api/quote', { method: 'POST', body: '{' });
  assert.equal((await handler(bad)).status, 400);
});

test('function: 422 on invalid lead, 200 on honeypot without forwarding', async () => {
  assert.equal((await handler(post({ name: 'x' }))).status, 422);
  let called = false;
  const orig = globalThis.fetch;
  globalThis.fetch = async () => { called = true; return new Response('{}'); };
  try {
    assert.equal((await handler(post({ ...good, company_website: 'x' }))).status, 200);
    assert.equal(called, false);
  } finally { globalThis.fetch = orig; }
});

test('function: forwards with token header and maps n8n reply', async () => {
  process.env.N8N_WEBHOOK_URL = 'https://n8n.example.test/webhook/x';
  process.env.N8N_INTAKE_TOKEN = 'test-token';
  const orig = globalThis.fetch;
  let seen;
  globalThis.fetch = async (url, init) => { seen = { url, init }; return new Response(JSON.stringify({ status: 'created', lead_id: 'L-1' }), { status: 200 }); };
  try {
    const res = await handler(post(good));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, status: 'created', lead_id: 'L-1' });
    assert.equal(seen.init.headers['x-intake-token'], 'test-token');
    assert.equal(JSON.parse(seen.init.body).source, 'netlify-quote-form');
  } finally { globalThis.fetch = orig; }
});

test('function: 502 when n8n rejects, 504 when unreachable', async () => {
  process.env.N8N_WEBHOOK_URL = 'https://n8n.example.test/webhook/x';
  process.env.N8N_INTAKE_TOKEN = 'test-token';
  const orig = globalThis.fetch;
  const origErr = console.error; console.error = () => {};
  try {
    globalThis.fetch = async () => new Response('{"message":"Authorization data is wrong!"}', { status: 403 });
    assert.equal((await handler(post(good))).status, 502);
    globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
    assert.equal((await handler(post(good))).status, 504);
  } finally { globalThis.fetch = orig; console.error = origErr; }
});
