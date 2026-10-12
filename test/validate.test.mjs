import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, validateTitle, normalizeCode, newListCode, CODE_RE } from '../lib/validate.mjs';

const base = { name: 'Ja Man', item: 'See the northern lights' };

test('minimal row gets defaults and nulls', () => {
  assert.deepEqual(validate(base), {
    ok: true,
    row: { name: 'Ja Man', item: 'See the northern lights', target_date: null, status: 'Not started', category: null, notes: null },
  });
});

test('full row passes through trimmed', () => {
  const r = validate({ ...base, item: '  Skydive ', target_date: '2027-03-15', status: 'Done', category: 'Adventure', notes: ' plan it ' });
  assert.equal(r.ok, true);
  assert.equal(r.row.item, 'Skydive');
  assert.equal(r.row.target_date, '2027-03-15');
  assert.equal(r.row.status, 'Done');
  assert.equal(r.row.category, 'Adventure');
  assert.equal(r.row.notes, 'plan it');
});

test('name whitespace is collapsed', () => {
  assert.equal(validate({ ...base, name: '  Ja   Man ' }).row.name, 'Ja Man');
});

test('empty strings become null', () => {
  const r = validate({ ...base, target_date: '', category: '', notes: '   ', status: '' });
  assert.deepEqual([r.row.target_date, r.row.category, r.row.notes, r.row.status], [null, null, null, 'Not started']);
});

test('required fields', () => {
  assert.equal(validate({ ...base, name: '   ' }).ok, false);
  assert.equal(validate({ ...base, item: '' }).ok, false);
  assert.equal(validate({ item: 'x' }).ok, false);
});

test('length caps count characters, not UTF-16 units', () => {
  assert.equal(validate({ ...base, name: 'a'.repeat(50) }).ok, true);
  assert.equal(validate({ ...base, name: 'a'.repeat(51) }).ok, false);
  assert.equal(validate({ ...base, name: '🎉'.repeat(50) }).ok, true);
  assert.equal(validate({ ...base, item: 'a'.repeat(201) }).ok, false);
  assert.equal(validate({ ...base, notes: 'a'.repeat(1001) }).ok, false);
});

test('status and category must be from the lists', () => {
  assert.equal(validate({ ...base, status: 'done' }).ok, false);
  assert.equal(validate({ ...base, category: 'Sports' }).ok, false);
});

test('target date must be a real calendar date', () => {
  for (const d of ['2026-02-30', '2026-13-01', '2026-1-5', '15/03/2027', '2026-02-29']) {
    assert.equal(validate({ ...base, target_date: d }).ok, false, d);
  }
  assert.equal(validate({ ...base, target_date: '2028-02-29' }).ok, true);
});

test('non-object bodies and non-string fields are rejected', () => {
  for (const b of [null, [], 'x', 42]) assert.equal(validate(b).ok, false);
  assert.equal(validate({ ...base, name: 5 }).ok, false);
  assert.equal(validate({ ...base, status: ['Done'] }).ok, false);
});

test('unknown fields are dropped', () => {
  const r = validate({ ...base, id: 9, created_at: 'x', completed_at: 'y' });
  assert.deepEqual(Object.keys(r.row).sort(), ['category', 'item', 'name', 'notes', 'status', 'target_date']);
});

test('list title is trimmed, collapsed and capped', () => {
  assert.deepEqual(validateTitle('  Uni   friends  '), { ok: true, title: 'Uni friends' });
  assert.equal(validateTitle('a'.repeat(60)).ok, true);
  assert.equal(validateTitle('a'.repeat(61)).ok, false);
  for (const t of ['', '   ', undefined, null, 5]) assert.equal(validateTitle(t).ok, false, String(t));
});

test('normalizeCode accepts a code or a pasted link', () => {
  assert.equal(normalizeCode('k7m2p9qx'), 'k7m2p9qx');
  assert.equal(normalizeCode('  K7M2P9QX '), 'k7m2p9qx');
  assert.equal(normalizeCode('https://example.netlify.app/#k7m2p9qx'), 'k7m2p9qx');
  for (const c of ['k7m2p9q', 'k7m2p9qxx', 'k7m2p9q0', 'k7m2p9ql', 'k7m2p9q!', '', '#', null, 42]) {
    assert.equal(normalizeCode(c), null, String(c));
  }
});

test('newListCode makes valid, distinct codes', () => {
  const codes = new Set(Array.from({ length: 1000 }, newListCode));
  assert.equal(codes.size, 1000);
  for (const c of codes) assert.match(c, CODE_RE);
});
