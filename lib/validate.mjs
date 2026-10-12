import { randomInt } from 'node:crypto';

export const STATUSES = ['Not started', 'In progress', 'Done'];
export const CATEGORIES = ['Travel', 'Adventure', 'Food', 'Learning', 'Experience', 'Other'];
const FIELDS = ['name', 'item', 'target_date', 'status', 'category', 'notes'];

const fail = (error) => ({ ok: false, error });
const length = (s) => [...s].length; // characters, matching Postgres char_length

function isRealDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

// Returns { ok: true, row } with only the editable columns, or { ok: false, error }.
export function validate(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return fail('Expected a JSON object');

  const v = {};
  for (const f of FIELDS) {
    if (body[f] != null && typeof body[f] !== 'string') return fail(`${f} must be text`);
    v[f] = (body[f] ?? '').trim();
  }

  const name = v.name.replace(/\s+/g, ' ');
  const status = v.status || 'Not started';

  if (!name) return fail('Name is required');
  if (length(name) > 50) return fail('Name must be 50 characters or fewer');
  if (!v.item) return fail('Bucket list item is required');
  if (length(v.item) > 200) return fail('Bucket list item must be 200 characters or fewer');
  if (length(v.notes) > 1000) return fail('Notes must be 1000 characters or fewer');
  if (!STATUSES.includes(status)) return fail(`Status must be one of: ${STATUSES.join(', ')}`);
  if (v.category && !CATEGORIES.includes(v.category)) return fail(`Category must be one of: ${CATEGORIES.join(', ')}`);
  if (v.target_date && !isRealDate(v.target_date)) return fail('Target date must be a real date (YYYY-MM-DD)');

  return {
    ok: true,
    row: {
      name,
      item: v.item,
      target_date: v.target_date || null,
      status,
      category: v.category || null,
      notes: v.notes || null,
    },
  };
}

// ---- lists ----

// List codes: 8 chars without look-alikes (0/o, 1/l/i). 31^8 ≈ 8.5e11 possibilities.
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const CODE_RE = /^[a-hjkmnp-z2-9]{8}$/;

export const newListCode = () => Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

// Accepts a bare code or a pasted share link (code after '#'). Returns the code or null.
export function normalizeCode(input) {
  if (typeof input !== 'string') return null;
  const code = input.trim().toLowerCase().split('#').pop();
  return CODE_RE.test(code) ? code : null;
}

export function validateTitle(input) {
  if (input != null && typeof input !== 'string') return fail('List name must be text');
  const title = (input ?? '').trim().replace(/\s+/g, ' ');
  if (!title) return fail('List name is required');
  if (length(title) > 60) return fail('List name must be 60 characters or fewer');
  return { ok: true, title };
}
