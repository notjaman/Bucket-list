-- Run once in the Supabase SQL editor.

-- A bucket list shared by a group. The code is the share key: whoever has it can view and edit.
create table lists (
  code       text primary key check (code ~ '^[a-hjkmnp-z2-9]{8}$'),
  title      text not null check (char_length(title) between 1 and 60),
  created_at timestamptz not null default now()
);

create table items (
  id           bigint generated always as identity primary key,
  list_code    text not null references lists(code) on delete cascade,
  name         text not null check (char_length(name) between 1 and 50),
  item         text not null check (char_length(item) between 1 and 200),
  target_date  date,
  status       text not null default 'Not started'
               check (status in ('Not started', 'In progress', 'Done')),
  category     text check (category in ('Travel', 'Adventure', 'Food', 'Learning', 'Experience', 'Other')),
  notes        text check (char_length(notes) <= 1000),
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);

create index items_list_code_idx on items (list_code);

-- Only the Netlify Function (secret key) may touch the tables.
-- RLS on with no policies blocks the publishable/anon key; the secret key bypasses RLS.
alter table lists enable row level security;
alter table items enable row level security;
revoke all on lists, items from anon, authenticated;
grant select, insert, update, delete on lists, items to service_role;

-- completed_at: stamped when status becomes Done, kept if it stays Done, cleared otherwise.
create function set_completed_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'Done' then
    new.completed_at := null;
  elsif tg_op = 'INSERT' then
    new.completed_at := now();
  else
    new.completed_at := coalesce(old.completed_at, now());
  end if;
  return new;
end;
$$;

create trigger items_completed_at
  before insert or update on items
  for each row execute function set_completed_at();
