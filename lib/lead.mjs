// Pure lead validation and normalisation, shared by the serverless function and the tests.

export const SERVICE_TYPES = ['ac-repair', 'heating-repair', 'maintenance', 'new-install', 'other'];
export const TIME_WINDOWS = ['morning', 'afternoon', 'evening', 'any'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ZIP_RE = /^\d{5}(-\d{4})?$/;

const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// US/Canada numbers only (the fictional client serves North America).
export function normalizePhone(raw) {
  let digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10 || /^[01]/.test(digits)) return null;
  return `+1${digits}`;
}

/**
 * Returns { ok: true, lead } or { ok: false, errors: {field: message} }.
 * A filled honeypot returns { ok: true, spam: true } so bots get a normal-looking reply.
 */
export function validateLead(input = {}) {
  if (clean(input.company_website, 200) !== '') return { ok: true, spam: true };

  const errors = {};
  const name = clean(input.name, 80);
  const email = clean(input.email, 120).toLowerCase();
  const phone = normalizePhone(input.phone);
  const zip = clean(input.zip, 10);
  const service = clean(input.service, 30);
  const window = clean(input.preferred_time, 20) || 'any';
  const message = clean(input.message, 1000);

  if (name.length < 2) errors.name = 'Please enter your name.';
  if (!phone) errors.phone = 'Please enter a 10-digit US or Canada phone number.';
  if (email && !EMAIL_RE.test(email)) errors.email = 'That email address does not look right.';
  if (!ZIP_RE.test(zip)) errors.zip = 'Please enter a 5-digit ZIP code.';
  if (!SERVICE_TYPES.includes(service)) errors.service = 'Please pick a service.';
  if (!TIME_WINDOWS.includes(window)) errors.preferred_time = 'Please pick a time window.';

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    lead: {
      name,
      phone,
      email: email || null,
      zip,
      service,
      preferred_time: window,
      message: message || null,
      // Same key the n8n workflow uses to skip repeat submissions.
      dedupe_key: `${phone}|${email || '-'}`,
    },
  };
}
