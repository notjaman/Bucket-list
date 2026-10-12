import { PostgrestClient } from '@supabase/postgrest-js';
import { validate, validateTitle, newListCode, CODE_RE } from '../../lib/validate.mjs';

// ponytail: REST client only; full supabase-js pulls in realtime, which crashes on Node < 22 without `ws`
const key = process.env.SUPABASE_SECRET_KEY;
const db = new PostgrestClient(`${process.env.SUPABASE_URL}/rest/v1`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});

const reply = (status, body) => (body === undefined ? new Response(null, { status }) : Response.json(body, { status }));
const fail = (status, error) => reply(status, { error });
const noList = () => fail(404, 'No list with that code');
const notAllowed = () => fail(405, 'Method not allowed');

function dbFail(err) {
  if (err.code === '23514') return fail(400, 'Invalid value'); // CHECK constraint, backstop for validate()
  console.error(err);
  return fail(500, 'Database error, try again shortly');
}

// Parse the JSON body and run a validator over it.
async function read(req, check) {
  let body;
  try {
    body = await req.json();
  } catch {
    return { ok: false, error: 'Invalid JSON' };
  }
  return check(body);
}

async function createList(req) {
  const v = await read(req, (b) => validateTitle(b?.title));
  if (!v.ok) return fail(400, v.error);
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await db.from('lists').insert({ code: newListCode(), title: v.title }).select('code,title').single();
    if (!error) return reply(201, data);
    if (error.code !== '23505') return dbFail(error); // 23505 = code collision, try another
  }
  return fail(500, 'Could not create a list, try again');
}

async function getList(code) {
  // ponytail: returns every item of the list (Supabase caps at 1000); add paging if a list grows that big
  const { data, error } = await db
    .from('lists')
    .select('code,title,created_at,items(*)')
    .eq('code', code)
    .order('created_at', { referencedTable: 'items', ascending: false })
    .maybeSingle();
  if (error) return dbFail(error);
  return data ? reply(200, data) : noList();
}

async function addItem(req, code) {
  const v = await read(req, validate);
  if (!v.ok) return fail(400, v.error);
  const { data, error } = await db.from('items').insert({ ...v.row, list_code: code }).select().single();
  if (error?.code === '23503') return noList(); // foreign key: list doesn't exist
  return error ? dbFail(error) : reply(201, data);
}

async function updateItem(req, code, id) {
  // Full editable row expected, so omitted optional fields are cleared on purpose.
  const v = await read(req, validate);
  if (!v.ok) return fail(400, v.error);
  const { data, error } = await db.from('items').update(v.row).eq('id', id).eq('list_code', code).select().maybeSingle();
  if (error) return dbFail(error);
  return data ? reply(200, data) : fail(404, 'Item not found');
}

async function deleteItem(code, id) {
  const { data, error } = await db.from('items').delete().eq('id', id).eq('list_code', code).select('id');
  if (error) return dbFail(error);
  return data.length ? reply(204) : fail(404, 'Item not found');
}

// /api/lists                      POST   create a list
// /api/lists/:code                GET    list + its items
// /api/lists/:code/items          POST   add an item
// /api/lists/:code/items/:id      PATCH  update an item, DELETE remove it
export default async (req) => {
  const [code, sub, idPart, ...rest] = new URL(req.url).pathname.split('/').filter(Boolean).slice(2);
  const method = req.method;

  if (!code) return method === 'POST' ? createList(req) : notAllowed();
  if (!CODE_RE.test(code) || (sub && sub !== 'items') || rest.length) return fail(404, 'Not found');
  if (!sub) return method === 'GET' ? getList(code) : notAllowed();
  if (!idPart) return method === 'POST' ? addItem(req, code) : notAllowed();

  if (!/^[1-9]\d{0,14}$/.test(idPart)) return fail(400, 'Invalid id');
  const id = Number(idPart);
  if (method === 'PATCH') return updateItem(req, code, id);
  if (method === 'DELETE') return deleteItem(code, id);
  return notAllowed();
};

export const config = {
  path: ['/api/lists', '/api/lists/*'],
  // ponytail: per-IP limit stops bot spam and code guessing, not a determined visitor; add a passcode if that matters
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
