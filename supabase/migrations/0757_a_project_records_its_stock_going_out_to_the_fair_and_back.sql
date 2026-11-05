-- 0757 · Projects slice 6: stock out to the fair and back, as a record on the project.
--
-- YH's ruling (chat, 2026-11-03): "decision all follow houzs, i repeat, all follow houzs".
-- Weisiang's decision (Mr Lim, WhatsApp 2026-10-22, via YH): clear Carres rules, implement Houzs.
-- Jess was not part of either decision.
--
-- Follows Houzs project_stock_transfers (backend/src/db/migrations/026_payment_and_stock.sql:32-55)
-- and its service (backend/src/services/projects.ts:2890-3100): one row per physical move,
-- direction `out` (to the venue before setup) or `return` (back after dismantle), the day it
-- happened (today in Malaysia when left empty), an optional photo or PDF of the transfer
-- sheet, notes, and a confirmation that someone checked the count. Removing a transfer
-- archives it (Houzs DELETE sets archived_at). Like Houzs, the record names no item, no
-- quantity and no warehouse, so it never moves stock: the exact Units still move only through
-- the Stock Transfer door (docs/stock/MASTER.md), and stock location keeps one record.
--
-- Houzs mirrors each transfer into one checklist task and logs activity from its service.
-- Here one trigger does both, so the record, its task and its activity rows commit together:
--   * the task links by project_checklist.stock_transfer_id instead of Houzs's notes marker
--     `auto:stock_transfer=<id>`, because Carres staff edit a task's notes (0752);
--   * the task has no due offset; its title carries the day, so moving the project start
--     never moves it (Houzs keeps an auto task's date on the transfer, not the schedule);
--   * removing a transfer removes its mirrored task, as Houzs deleteStockTransferTask does.
--     That delete runs inside the trigger at use time; this migration deletes nothing.
-- confirmed_by and created_by are stamped from the caller's token, never taken from the body.
--
-- RLS: project_stock_transfers admits Operation and the principal (public.is_operation(),
-- the 0750 rule) to read, add and update; there is no delete right. project_activity's action
-- list gains the three Houzs transfer actions; its policies are unchanged (staff still insert
-- only notes; the trigger writes the rest). The private bucket project-stock-records lets
-- Operation and the principal read and upload; no update or delete policy, so a record file
-- is never replaced. No table dropped, no row deleted.

begin;

create table if not exists public.project_stock_transfers (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects(id) on delete cascade,
  direction      text not null check (direction in ('out', 'return')),
  -- Houzs: a transfer with no date defaults to today in Malaysia, never refused; date only.
  transferred_at date not null default (now() at time zone 'Asia/Kuala_Lumpur')::date,
  record_path    text check (record_path is null or record_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|jpg|png|webp)$'),
  file_name      text check (file_name is null or length(file_name) <= 200),
  mime_type      text check (mime_type is null or mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  notes          text check (notes is null or length(notes) <= 1000),
  confirmed_at   timestamptz,
  confirmed_by   uuid references public.app_users(id) on delete set null,
  created_by     uuid references public.app_users(id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  archived_at    timestamptz
);
create index if not exists project_stock_transfers_project_idx on public.project_stock_transfers (project_id, direction);

alter table public.project_checklist
  add column if not exists stock_transfer_id uuid references public.project_stock_transfers(id) on delete cascade;
create unique index if not exists project_checklist_stock_transfer_key
  on public.project_checklist (stock_transfer_id) where stock_transfer_id is not null;
comment on column public.project_checklist.stock_transfer_id is
  '0757 (Houzs auto:stock_transfer marker): the stock transfer this task mirrors. Written only by the transfer trigger.';

alter table public.project_activity drop constraint if exists project_activity_action_check;
alter table public.project_activity add constraint project_activity_action_check check (action in (
  'created', 'stage_change', 'status_change', 'archived', 'unarchived', 'note',
  'stock_transfer_add', 'stock_transfer_confirm', 'stock_transfer_unconfirm'
));

-- Stamp who added and who confirmed from the token.
create or replace function public.project_stock_transfer_stamp()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.archived_at := null;
  end if;
  if new.confirmed_at is null then
    new.confirmed_by := null;
  elsif tg_op = 'INSERT' or old.confirmed_at is null then
    new.confirmed_at := now();
    new.confirmed_by := auth.uid();
  else
    new.confirmed_at := old.confirmed_at;
    new.confirmed_by := old.confirmed_by;
  end if;
  return new;
end;
$$;
revoke all on function public.project_stock_transfer_stamp() from public, anon, authenticated;

-- Houzs syncStockTransferTask, deleteStockTransferTask and logProjectActivity in one place.
create or replace function public.project_stock_transfer_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text := case new.direction when 'out' then 'Stock out, ' else 'Stock return, ' end
                  || to_char(new.transferred_at, 'FMDD Mon YYYY');
  v_done boolean := new.confirmed_at is not null;
begin
  if new.archived_at is not null then
    delete from public.project_checklist where stock_transfer_id = new.id;
  elsif exists (select 1 from public.project_checklist where stock_transfer_id = new.id) then
    update public.project_checklist
       set title = v_title,
           status = case when v_done then 'done' else 'pending' end,
           completed_by = case when v_done then new.confirmed_by end,
           completed_at = case when v_done then new.confirmed_at end
     where stock_transfer_id = new.id;
  else
    insert into public.project_checklist (project_id, seq, title, status, completed_by, completed_at, stock_transfer_id)
    values (new.project_id, 9000, v_title, case when v_done then 'done' else 'pending' end,
            case when v_done then new.confirmed_by end, case when v_done then new.confirmed_at end, new.id);
  end if;

  if tg_op = 'INSERT' then
    insert into public.project_activity (project_id, action, to_value, note)
    values (new.project_id, 'stock_transfer_add', new.direction, new.notes);
  elsif new.confirmed_at is distinct from old.confirmed_at and new.archived_at is null then
    insert into public.project_activity (project_id, action, to_value)
    values (new.project_id, case when v_done then 'stock_transfer_confirm' else 'stock_transfer_unconfirm' end, new.direction);
  end if;
  return new;
end;
$$;
revoke all on function public.project_stock_transfer_sync() from public, anon, authenticated;

drop trigger if exists project_stock_transfers_stamp on public.project_stock_transfers;
create trigger project_stock_transfers_stamp before insert or update on public.project_stock_transfers
  for each row execute function public.project_stock_transfer_stamp();
drop trigger if exists project_stock_transfers_sync on public.project_stock_transfers;
create trigger project_stock_transfers_sync after insert or update on public.project_stock_transfers
  for each row execute function public.project_stock_transfer_sync();

alter table public.project_stock_transfers enable row level security;
revoke all on public.project_stock_transfers from public, anon, authenticated;
grant select, insert, update on public.project_stock_transfers to authenticated;
drop policy if exists project_stock_transfers_read on public.project_stock_transfers;
create policy project_stock_transfers_read on public.project_stock_transfers for select using ((select public.is_operation()));
drop policy if exists project_stock_transfers_insert on public.project_stock_transfers;
create policy project_stock_transfers_insert on public.project_stock_transfers for insert with check ((select public.is_operation()));
drop policy if exists project_stock_transfers_update on public.project_stock_transfers;
create policy project_stock_transfers_update on public.project_stock_transfers for update
  using ((select public.is_operation())) with check ((select public.is_operation()));

-- The transfer sheet file (Houzs PUT /:id/stock-transfers/upload, 10 MB; xlsx is left out).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-stock-records', 'project-stock-records', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists project_stock_records_select on storage.objects;
drop policy if exists project_stock_records_insert on storage.objects;
create policy project_stock_records_select on storage.objects
  for select to authenticated
  using (bucket_id = 'project-stock-records' and (select public.is_operation()));
create policy project_stock_records_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'project-stock-records' and (select public.is_operation()));
-- Deliberately NO update and NO delete policy: a record file is never replaced.

commit;
