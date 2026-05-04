-- ============================================================================
--  Pulse — initial schema (PERSONAL MODE, no auth).
--
--  This is the personal-use variant: a single hardcoded user row, RLS
--  disabled, every `user_id` column defaults to 'me'. Run this once in
--  the Supabase SQL editor and you're ready to go.
--
--  If you ever want to make this multi-user, the easy path is:
--    1. enable RLS on every public.* table
--    2. drop the `default 'me'` on user_id columns
--    3. add policies of the form `auth.uid()::text = user_id`
-- ============================================================================

-- Extensions
create extension if not exists "uuid-ossp";

-- ────────────────────────────────────────────────────────────────────────────
-- Enums
-- ────────────────────────────────────────────────────────────────────────────
create type account_type     as enum ('cash', 'bank', 'credit', 'wallet', 'savings');
create type category_type    as enum ('income', 'expense');
create type transaction_type as enum ('income', 'expense', 'transfer');
create type frequency        as enum ('daily', 'weekly', 'monthly', 'yearly');
create type budget_period    as enum ('weekly', 'monthly');
create type insight_type     as enum ('weekly_summary', 'anomaly', 'tip', 'streak');

-- ────────────────────────────────────────────────────────────────────────────
-- Tables
-- ────────────────────────────────────────────────────────────────────────────

-- The only user row. Defaults are wired so every other table can reference
-- it without us ever passing a `user_id` from the app.
create table public.users (
  id          text        primary key default 'me',
  email       text        not null    default 'me@local',
  name        text                    default 'You',
  currency    text        not null    default 'PKR',
  theme       text        not null    default 'dark',
  created_at  timestamptz not null    default now()
);

-- Pre-create the local user so FKs resolve.
insert into public.users (id) values ('me') on conflict (id) do nothing;

create table public.accounts (
  id          uuid          primary key default uuid_generate_v4(),
  user_id     text          not null    default 'me' references public.users(id) on delete cascade,
  name        text          not null,
  type        account_type  not null,
  balance     numeric(14,2) not null    default 0,
  color       text          not null    default '#10b981',
  icon        text          not null    default 'wallet',
  archived    boolean       not null    default false,
  created_at  timestamptz   not null    default now()
);
create index accounts_user_id_idx on public.accounts(user_id);

create table public.categories (
  id         uuid          primary key default uuid_generate_v4(),
  user_id    text          not null    default 'me' references public.users(id) on delete cascade,
  name       text          not null,
  icon       text          not null,
  color      text          not null,
  type       category_type not null,
  parent_id  uuid          references public.categories(id) on delete set null
);
create index categories_user_id_idx on public.categories(user_id);

create table public.recurring (
  id           uuid          primary key default uuid_generate_v4(),
  user_id      text          not null    default 'me' references public.users(id) on delete cascade,
  account_id   uuid          not null references public.accounts(id) on delete cascade,
  category_id  uuid          references public.categories(id) on delete set null,
  amount       numeric(14,2) not null,
  frequency    frequency     not null,
  next_run     date          not null,
  note         text,
  active       boolean       not null    default true
);
create index recurring_user_id_idx  on public.recurring(user_id);
create index recurring_next_run_idx on public.recurring(next_run) where active = true;

create table public.transactions (
  id            uuid             primary key default uuid_generate_v4(),
  user_id       text             not null    default 'me' references public.users(id) on delete cascade,
  account_id    uuid             not null references public.accounts(id) on delete cascade,
  category_id   uuid             references public.categories(id) on delete set null,
  amount        numeric(14,2)    not null,
  type          transaction_type not null,
  note          text,
  date          timestamptz      not null    default now(),
  is_recurring  boolean          not null    default false,
  recurring_id  uuid             references public.recurring(id) on delete set null,
  created_at    timestamptz      not null    default now()
);
create index transactions_user_id_idx    on public.transactions(user_id);
create index transactions_account_idx    on public.transactions(account_id);
create index transactions_category_idx   on public.transactions(category_id);
create index transactions_user_date_idx  on public.transactions(user_id, date desc);

create table public.budgets (
  id           uuid          primary key default uuid_generate_v4(),
  user_id      text          not null    default 'me' references public.users(id) on delete cascade,
  category_id  uuid          not null references public.categories(id) on delete cascade,
  amount       numeric(14,2) not null,
  period       budget_period not null,
  start_date   date          not null
);
create index budgets_user_id_idx on public.budgets(user_id);

create table public.shortcuts (
  id           uuid          primary key default uuid_generate_v4(),
  user_id      text          not null    default 'me' references public.users(id) on delete cascade,
  label        text          not null,
  amount       numeric(14,2) not null,
  category_id  uuid          references public.categories(id) on delete set null,
  account_id   uuid          references public.accounts(id) on delete set null,
  position     integer       not null    default 0
);
create index shortcuts_user_id_idx on public.shortcuts(user_id);

create table public.insights (
  id          uuid         primary key default uuid_generate_v4(),
  user_id     text         not null    default 'me' references public.users(id) on delete cascade,
  type        insight_type not null,
  message     text         not null,
  data_json   jsonb,
  created_at  timestamptz  not null    default now(),
  dismissed   boolean      not null    default false
);
create index insights_user_id_idx           on public.insights(user_id);
create index insights_user_undismissed_idx  on public.insights(user_id, created_at desc)
  where dismissed = false;

-- ────────────────────────────────────────────────────────────────────────────
-- Default categories (the 8 from the seed script)
-- ────────────────────────────────────────────────────────────────────────────
insert into public.categories (name, icon, color, type) values
  ('Food',          'utensils',        '#f97316', 'expense'),
  ('Transport',     'car',             '#3b82f6', 'expense'),
  ('Shopping',      'shopping-bag',    '#ec4899', 'expense'),
  ('Bills',         'receipt',         '#ef4444', 'expense'),
  ('Entertainment', 'film',            '#a855f7', 'expense'),
  ('Health',        'heart-pulse',     '#14b8a6', 'expense'),
  ('Salary',        'wallet',          '#10b981', 'income'),
  ('Other',         'more-horizontal', '#71717a', 'expense')
on conflict do nothing;

-- ============================================================================
--  RLS is intentionally OFF — this is single-user.
--  The Supabase anon key (used by the app) gives full read/write access
--  to your data. That's fine here because there's nothing else in the DB
--  and the app sits behind a biometric lock.
-- ============================================================================
