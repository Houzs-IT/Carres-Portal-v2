-- =============================================================================
-- 0754_a_projects_money_comes_from_the_books.sql
-- =============================================================================
-- THE RULING
--   Weisiang's decision (Mr Lim, 2026-10-22): clear Carres rules, implement
--   Houzs. YH, 3 Nov 2026: "decision all follow houzs, i repeat, all follow
--   houzs". Jess was not part of this decision.
--
-- WHAT HOUZS DOES (docs/modules/projects-pms.md, "The event page's finance
--   lines take Finance's money from the books"; scm/lib/event-books.ts;
--   scm/lib/event-accounts.ts; services/eventPnl.ts)
--   · Finance marks an account "needs Event" and names the row of the event
--     page it fills (rental, setup, transport setup & dismantle, transport
--     fee, commission, others). A voucher or bill line on a needs-Event
--     account is refused at the step that posts until it names its event.
--   · A voucher or bill line names its event; its own ledger leg carries it.
--   · The event page reads, live: posted legs tagged to the event (neither
--     side of a reversal pair), and voucher lines Finance has checked but not
--     yet approved. A row the books fill replaces the typed lines of that row.
--   · Typed lines, a Total Sales figure and a brand rate card feed two P&Ls.
--   · Only Finance viewers see an event's money; ordinary staff see none.
--
-- WHAT THIS CHANGES IN CARRES
--   1. gl_accounts.needs_project, gl_accounts.project_row.
--   2. project_id on gl_entry_lines, supplier_bill_lines, payment_voucher_lines.
--   3. gl_post writes a line's project_id. supplier_bill_save_draft and
--      payment_voucher_save_draft store it; supplier_bill_confirm and
--      payment_voucher_approve pass it to the ledger and refuse a line on a
--      needs-project account that has none. A manual journal passes its
--      lines to gl_post as they are, so it carries project_id with no change.
--   4. The two document reads return each line's project.
--   5. project_finance_lines (typed lines), projects.total_sales,
--      project_cost_rates (brand rate cards).
--   6. Readers and doors for Finance and Principal only (gl_may_read):
--      project_money, project_books, project_cost_rates_list,
--      fin_project_options, and the
--      writes for typed lines, Total Sales, rate cards and the account flags.
--   Functions are changed in place (pg_get_functiondef plus one exact
--   snippet each, as 0683 and 0689 do), so every earlier change stands.
--
-- RLS: the three new columns sit on tables whose policies already cover
--   every column. project_finance_lines and project_cost_rates enable RLS
--   with no policy: they are read and written only through the security
--   definer functions below, which gate on gl_may_read(). projects keeps its
--   Operation policies; Finance reads a project only through project_money.
-- DATA: nothing is dropped, deleted or rewritten. Old lines stay untagged.
-- =============================================================================

begin;

set local search_path = public, pg_temp;

-- Replace one exact snippet of a live function; refuse unless it occurs once.
create or replace function pg_temp.mig0754_rewrite(p_fn regprocedure, p_old text, p_new text)
returns void
language plpgsql
as $rw$
declare
  -- Line ends are normalised on the body and on both texts: CRLF or a lone CR,
  -- and spaces or tabs before a line end, from a Windows copy of this file or
  -- an editor paste (0739). Only line-end whitespace changes; one hit is still required.
  v_def text := regexp_replace(replace(replace(pg_get_functiondef(p_fn), E'\r\n', E'\n'), E'\r', E'\n'), E'[ \t]+\n', E'\n', 'g');
  v_n   integer;
begin
  p_old := regexp_replace(replace(replace(p_old, E'\r\n', E'\n'), E'\r', E'\n'), E'[ \t]+\n', E'\n', 'g');
  p_new := regexp_replace(replace(replace(p_new, E'\r\n', E'\n'), E'\r', E'\n'), E'[ \t]+\n', E'\n', 'g');
  v_n := (length(v_def) - length(replace(v_def, p_old, ''))) / greatest(length(p_old), 1);
  if v_n <> 1 then
    raise exception '0754: % holds the text to change % times, not once: %', p_fn, v_n, left(p_old, 90);
  end if;
  execute replace(v_def, p_old, p_new);
end;
$rw$;

-- ── 1 · the chart: which accounts need a project, and which row they fill ────
alter table public.gl_accounts
  add column if not exists needs_project boolean not null default false,
  add column if not exists project_row text;
alter table public.gl_accounts drop constraint if exists gl_accounts_project_row_known;
alter table public.gl_accounts add constraint gl_accounts_project_row_known check (
  project_row is null
  or project_row in ('rental','setup','transport_setup_dismantle','transport_fee','commission','others'));
comment on column public.gl_accounts.needs_project is
  '0754 (Houzs scm.accounts.needs_event): a bill or voucher line on this account is refused at confirm or approve until it names its project.';
comment on column public.gl_accounts.project_row is
  '0754 (Houzs scm.accounts.pms_row): the row of the project page money on this account fills. Null on an expense account = Others Costing.';

-- ── 2 · a line names its project ─────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['gl_entry_lines','supplier_bill_lines','payment_voucher_lines'] loop
    execute format('alter table public.%I add column if not exists project_id uuid references public.projects(id)', t);
    execute format('create index if not exists %I on public.%I (project_id) where project_id is not null',
                   t || '_project_idx', t);
  end loop;
end $$;

-- A line's project, checked; null = none. Definer: Finance may not read projects directly.
create or replace function public.fin_line_project(p_line jsonb, p_what text)
returns uuid
language plpgsql stable security definer set search_path = public
as $fn$
declare v uuid;
begin
  begin
    v := nullif(btrim(coalesce(p_line ->> 'project_id', '')), '')::uuid;
  exception when invalid_text_representation then
    raise exception '%: That project is not on the list.', p_what
      using errcode = 'P0001', detail = 'line_project_refused';
  end;
  if v is not null and not exists (select 1 from public.projects p where p.id = v) then
    raise exception '%: That project is not on the list.', p_what
      using errcode = 'P0001', detail = 'line_project_refused';
  end if;
  return v;
end;
$fn$;
revoke all on function public.fin_line_project(jsonb, text) from public, anon;
grant execute on function public.fin_line_project(jsonb, text) to authenticated;

-- The first line on a needs-project account with no project, as a refusal
-- (Houzs eventAccountRefusal: refused at the step that posts).
create or replace function public.fin_refuse_untagged_lines(p_lines jsonb)
returns void
language plpgsql stable set search_path = public
as $fn$
declare r record;
begin
  select l.ord, a.code, a.name into r
    from jsonb_array_elements(p_lines) with ordinality l(v, ord)
    join public.gl_accounts a on a.code = l.v ->> 'account_code'
   where a.needs_project
     and nullif(btrim(coalesce(l.v ->> 'project_id', '')), '') is null
   order by l.ord
   limit 1;
  if found then
    raise exception 'Line % (% %) needs its project. Choose it, or Finance unticks Needs project on the account.', r.ord, r.code, r.name
      using errcode = 'P0001', detail = 'project_required_on_line';
  end if;
end;
$fn$;
revoke all on function public.fin_refuse_untagged_lines(jsonb) from public, anon;
grant execute on function public.fin_refuse_untagged_lines(jsonb) to authenticated;

-- ── 3 · typed lines, Total Sales, rate cards ─────────────────────────────────
create table if not exists public.project_finance_lines (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id),
  kind        text not null check (kind in ('cost','income')),
  category    text not null check (btrim(category) <> '' and length(category) <= 40),
  description text not null check (btrim(description) <> '' and length(description) <= 300),
  amount      numeric(12,2) not null,
  occurred_at date,
  created_by  uuid references public.app_users(id),
  created_at  timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references public.app_users(id)
);
create index if not exists project_finance_lines_project_idx
  on public.project_finance_lines (project_id) where archived_at is null;
alter table public.project_finance_lines enable row level security;
comment on table public.project_finance_lines is
  '0754 (Houzs project_finance_lines): money typed on a project. A row the books fill replaces its typed lines at read time.';

alter table public.projects add column if not exists total_sales numeric(12,2)
  check (total_sales is null or total_sales >= 0);
comment on column public.projects.total_sales is
  '0754 (Houzs project_finance.total_sales): the fair''s sales as the team keys them. Drives the By Total Sales P&L.';

create table if not exists public.project_cost_rates (
  brand                 text primary key check (btrim(brand) <> '' and length(brand) <= 120),
  transport_pct         numeric(6,2) not null default 0 check (transport_pct between 0 and 100),
  merchandise_pct       numeric(6,2) not null default 0 check (merchandise_pct between 0 and 100),
  commission_normal_pct numeric(6,2) not null default 0 check (commission_normal_pct between 0 and 100),
  commission_boost_pct  numeric(6,2) check (commission_boost_pct between 0 and 100),
  boost_min_gp_pct      numeric(6,2) check (boost_min_gp_pct between 0 and 100),
  boost_min_sales       numeric(12,2) check (boost_min_sales >= 0),
  updated_at            timestamptz not null default now(),
  updated_by            uuid references public.app_users(id)
);
alter table public.project_cost_rates enable row level security;
comment on table public.project_cost_rates is
  '0754 (Houzs project_cost_rates): a brand''s rate card. Transport Fee, Merchandise and Commission fall back to these % of sales.';

-- ── 4 · the functions that carry a line's project, changed in place ────────

select pg_temp.mig0754_rewrite('public.gl_post(text,text,date,text,jsonb)'::regprocedure,
$o$      'department_id',   v_dept_id
    );$o$,
$n$      'department_id',   v_dept_id,
      'project_id',      public.fin_line_project(v_elem, format('gl_post line %s', v_idx))   -- 0754
    );$n$);

select pg_temp.mig0754_rewrite('public.gl_post(text,text,date,text,jsonb)'::regprocedure,
$o$     department_type, department_id)
  select v_entry_id,$o$,
$n$     department_type, department_id, project_id)
  select v_entry_id,$n$);

select pg_temp.mig0754_rewrite('public.gl_post(text,text,date,text,jsonb)'::regprocedure,
$o$         (l->>'department_id')::uuid
    from jsonb_array_elements(v_norm) l;$o$,
$n$         (l->>'department_id')::uuid,
         (l->>'project_id')::uuid
    from jsonb_array_elements(v_norm) l;$n$);

select pg_temp.mig0754_rewrite('public.supplier_bill_save_draft(uuid,uuid,text,date,jsonb,date,text,text)'::regprocedure,
$o$           warehouse_receipt_id, po_line_id, department_type, department_id, account_chosen)
        values
          (v_id, v_out, v_account, v_desc, v_sku, v_part.qty, v_price, v_part_amt,
           v_rcpt, v_pol_id, v_part.department_type, v_part.department_id,
$o$,
$n$           warehouse_receipt_id, po_line_id, department_type, department_id, account_chosen, project_id)
        values
          (v_id, v_out, v_account, v_desc, v_sku, v_part.qty, v_price, v_part_amt,
           v_rcpt, v_pol_id, v_part.department_type, v_part.department_id,
$n$);

select pg_temp.mig0754_rewrite('public.supplier_bill_save_draft(uuid,uuid,text,date,jsonb,date,text,text)'::regprocedure,
$o$           nullif(btrim(coalesce(v_line ->> 'account_code', '')), '') is not null);
        v_total := v_total + v_part_amt;$o$,
$n$           nullif(btrim(coalesce(v_line ->> 'account_code', '')), '') is not null,
           public.fin_line_project(v_line, format('Line %s', v_n)));   -- 0754
        v_total := v_total + v_part_amt;$n$);

select pg_temp.mig0754_rewrite('public.supplier_bill_save_draft(uuid,uuid,text,date,jsonb,date,text,text)'::regprocedure,
$o$         delivery_order_id)
      values$o$,
$n$         delivery_order_id, project_id)
      values$n$);

select pg_temp.mig0754_rewrite('public.supplier_bill_save_draft(uuid,uuid,text,date,jsonb,date,text,text)'::regprocedure,
$o$         v_do_id);
      v_total := v_total + v_amount;$o$,
$n$         v_do_id, public.fin_line_project(v_line, format('Line %s', v_n)));   -- 0754
      v_total := v_total + v_amount;$n$);

select pg_temp.mig0754_rewrite('public.supplier_bill_save_draft(uuid,uuid,text,date,jsonb,date,text,text)'::regprocedure,
$o$         warehouse_receipt_id, po_line_id, department_type, department_id, account_chosen)
      values
        (v_id, v_out, v_account, v_desc, v_sku, v_qty, v_price, v_amount,
         v_rcpt, v_pol_id, v_dept.department_type, v_dept.department_id,
         -- 0659: a non-goods line's account is always chosen.
         true);$o$,
$n$         warehouse_receipt_id, po_line_id, department_type, department_id, account_chosen, project_id)
      values
        (v_id, v_out, v_account, v_desc, v_sku, v_qty, v_price, v_amount,
         v_rcpt, v_pol_id, v_dept.department_type, v_dept.department_id,
         -- 0659: a non-goods line's account is always chosen.
         true, public.fin_line_project(v_line, format('Line %s', v_n)));   -- 0754$n$);

select pg_temp.mig0754_rewrite('public.payment_voucher_save_draft(uuid,text,uuid,text,date,text,jsonb,jsonb,text,text,text,numeric)'::regprocedure,
$o$      (voucher_id, line_no, account_code, description, amount, department_type, department_id)
$o$,
$n$      (voucher_id, line_no, account_code, description, amount, department_type, department_id, project_id)
$n$);

select pg_temp.mig0754_rewrite('public.payment_voucher_save_draft(uuid,text,uuid,text,date,text,jsonb,jsonb,text,text,text,numeric)'::regprocedure,
$o$            v_dept.department_type, v_dept.department_id);
  end loop;$o$,
$n$            v_dept.department_type, v_dept.department_id,
            public.fin_line_project(v_line, format('Line %s', v_n)));   -- 0754
  end loop;$n$);

select pg_temp.mig0754_rewrite('public.supplier_bill_confirm(uuid)'::regprocedure,
$o$             'department_id',   l.department_id)
           order by l.line_no)$o$,
$n$             'department_id',   l.department_id,
             'project_id',      l.project_id)   -- 0754
           order by l.line_no)$n$);

select pg_temp.mig0754_rewrite('public.supplier_bill_confirm(uuid)'::regprocedure,
$o$  v_entry := public.gl_post(
    'SUPPLIER_BILL',$o$,
$n$  -- 0754 (Houzs eventAccountRefusal): a needs-project line without its project stops here.
  perform public.fin_refuse_untagged_lines(v_lines);

  v_entry := public.gl_post(
    'SUPPLIER_BILL',$n$);

select pg_temp.mig0754_rewrite('public.payment_voucher_approve(uuid)'::regprocedure,
$o$  for r in select l.account_code, l.amount, l.description, l.department_type, l.department_id
$o$,
$n$  for r in select l.account_code, l.amount, l.description, l.department_type, l.department_id, l.project_id
$n$);

select pg_temp.mig0754_rewrite('public.payment_voucher_approve(uuid)'::regprocedure,
$o$      'department_id',   r.department_id));
  end loop;$o$,
$n$      'department_id',   r.department_id,
      'project_id',      r.project_id));   -- 0754
  end loop;$n$);

select pg_temp.mig0754_rewrite('public.payment_voucher_approve(uuid)'::regprocedure,
$o$  v_entry := public.gl_post($o$,
$n$  -- 0754 (Houzs eventAccountRefusal): a needs-project line without its project stops here.
  perform public.fin_refuse_untagged_lines(v_lines);

  v_entry := public.gl_post($n$);

select pg_temp.mig0754_rewrite('public.supplier_bill_document(uuid)'::regprocedure,
$o$               bl.delivery_order_id, dor.do_number as do_no,   -- 0689
$o$,
$n$               bl.delivery_order_id, dor.do_number as do_no,   -- 0689
               bl.project_id,   -- 0754
$n$);

select pg_temp.mig0754_rewrite('public.payment_voucher_document(uuid)'::regprocedure,
$o$        select l.line_no, l.account_code, ac.name as account_name, l.description, l.amount
$o$,
$n$        select l.line_no, l.account_code, ac.name as account_name, l.description, l.amount, l.project_id   -- 0754
$n$);

-- ── 5 · reads: Finance and Principal only (Houzs: finance viewers) ──────────

-- Every project, for the line picker on a bill, a voucher or a journal.
create or replace function public.fin_project_options()
returns table (id uuid, code text, name text, start_date date, end_date date, archived boolean)
language sql stable security definer set search_path = public
as $fn$
  select p.id, p.code, p.name, p.start_date, p.end_date, p.archived_at is not null
    from public.projects p
   where public.gl_may_read()
   order by p.start_date desc, p.code;
$fn$;
revoke all on function public.fin_project_options() from public, anon;
grant execute on function public.fin_project_options() to authenticated;

-- The books of some projects: posted legs tagged to them, on neither side of
-- a reversal, plus voucher lines checked but not yet approved (Houzs
-- readEventBooks + readCheckedVoucherLegs). Read live, never copied.
create or replace function public.project_books(p_project_ids uuid[])
returns table (project_id uuid, leg_id text, account_code text, account_name text, account_kind text,
               project_row text, debit numeric, credit numeric, memo text, doc_no text,
               entry_date date, checked boolean)
language sql stable security definer set search_path = public
as $fn$
  select l.project_id, l.id::text, l.account_code, a.name, a.kind, a.project_row,
         l.debit, l.credit, l.memo, e.source_doc_no, e.entry_date, false
    from public.gl_entry_lines l
    join public.gl_entries e on e.id = l.entry_id
    left join public.gl_accounts a on a.code = l.account_code
   where public.gl_may_read()
     and l.project_id = any (p_project_ids)
     and e.posted and not e.reversed and e.reverses is null
  union all
  select vl.project_id, 'pv:' || vl.id::text, vl.account_code, a.name, a.kind, a.project_row,
         vl.amount, 0, vl.description, coalesce(v.voucher_no, 'Payment voucher'), v.voucher_date, true
    from public.payment_voucher_lines vl
    join public.payment_vouchers v on v.id = vl.voucher_id
    left join public.gl_accounts a on a.code = vl.account_code
   where public.gl_may_read()
     and vl.project_id = any (p_project_ids)
     and v.status = 'checked'
  order by 11, 10;
$fn$;
revoke all on function public.project_books(uuid[]) from public, anon;
grant execute on function public.project_books(uuid[]) to authenticated;

-- What the P&L needs that the books do not hold: the project, its typed
-- lines, Total Sales and its brand's rate card.
create or replace function public.project_money(p_project_ids uuid[])
returns table (id uuid, code text, name text, brand text, status text, start_date date, end_date date,
               archived boolean, total_sales numeric, lines jsonb, rate jsonb)
language sql stable security definer set search_path = public
as $fn$
  select p.id, p.code, p.name, p.brand, p.status, p.start_date, p.end_date, p.archived_at is not null, p.total_sales,
         coalesce((select jsonb_agg(jsonb_build_object(
                     'id', f.id, 'kind', f.kind, 'category', f.category, 'description', f.description,
                     'amount', f.amount, 'occurredAt', f.occurred_at) order by f.occurred_at desc nulls last, f.created_at desc)
                     from public.project_finance_lines f
                    where f.project_id = p.id and f.archived_at is null), '[]'::jsonb),
         (select to_jsonb(r) - 'updated_at' - 'updated_by' from public.project_cost_rates r where r.brand = p.brand)
    from public.projects p
   where public.gl_may_read()
     and (p_project_ids is null or p.id = any (p_project_ids))
   order by p.start_date desc, p.code;
$fn$;
revoke all on function public.project_money(uuid[]) from public, anon;
grant execute on function public.project_money(uuid[]) to authenticated;

create or replace function public.project_cost_rates_list()
returns setof public.project_cost_rates
language sql stable security definer set search_path = public
as $fn$ select * from public.project_cost_rates where public.gl_may_read() order by brand $fn$;
revoke all on function public.project_cost_rates_list() from public, anon;
grant execute on function public.project_cost_rates_list() to authenticated;

-- ── 6 · writes: Finance and Principal only ───────────────────────────────────
create or replace function public._project_money_gate()
returns void
language plpgsql stable set search_path = public
as $fn$
begin
  if not public.gl_may_read() then
    raise exception 'Only Finance sees and changes a project''s money.'
      using errcode = '42501', detail = 'not_finance';
  end if;
end;
$fn$;
revoke all on function public._project_money_gate() from public, anon, authenticated;

create or replace function public.project_money_line_add(
  p_project_id uuid, p_kind text, p_category text, p_description text, p_amount numeric, p_occurred_at date)
returns uuid
language plpgsql security definer set search_path = public
as $fn$
declare v_id uuid;
begin
  perform public._project_money_gate();
  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'That project does not exist.' using errcode = 'P0002', detail = 'project_not_found';
  end if;
  insert into public.project_finance_lines (project_id, kind, category, description, amount, occurred_at, created_by)
  values (p_project_id, p_kind, btrim(p_category), btrim(p_description), round(p_amount, 2), p_occurred_at,
          (select u.id from public.app_users u where u.id = auth.uid()))
  returning id into v_id;
  return v_id;
end;
$fn$;
revoke all on function public.project_money_line_add(uuid, text, text, text, numeric, date) from public, anon;
grant execute on function public.project_money_line_add(uuid, text, text, text, numeric, date) to authenticated;

-- A typed line is archived, never deleted (Houzs archived_at).
create or replace function public.project_money_line_archive(p_line_id uuid)
returns void
language plpgsql security definer set search_path = public
as $fn$
begin
  perform public._project_money_gate();
  update public.project_finance_lines
     set archived_at = now(), archived_by = (select u.id from public.app_users u where u.id = auth.uid())
   where id = p_line_id and archived_at is null;
  if not found then
    raise exception 'That line is not on the project.' using errcode = 'P0002', detail = 'line_not_found';
  end if;
end;
$fn$;
revoke all on function public.project_money_line_archive(uuid) from public, anon;
grant execute on function public.project_money_line_archive(uuid) to authenticated;

create or replace function public.project_total_sales_set(p_project_id uuid, p_total numeric)
returns void
language plpgsql security definer set search_path = public
as $fn$
begin
  perform public._project_money_gate();
  update public.projects set total_sales = round(p_total, 2) where id = p_project_id;
  if not found then
    raise exception 'That project does not exist.' using errcode = 'P0002', detail = 'project_not_found';
  end if;
end;
$fn$;
revoke all on function public.project_total_sales_set(uuid, numeric) from public, anon;
grant execute on function public.project_total_sales_set(uuid, numeric) to authenticated;

create or replace function public.project_cost_rate_set(
  p_brand text, p_transport_pct numeric, p_merchandise_pct numeric, p_commission_normal_pct numeric,
  p_commission_boost_pct numeric, p_boost_min_gp_pct numeric, p_boost_min_sales numeric)
returns void
language plpgsql security definer set search_path = public
as $fn$
begin
  perform public._project_money_gate();
  insert into public.project_cost_rates as r
    (brand, transport_pct, merchandise_pct, commission_normal_pct, commission_boost_pct, boost_min_gp_pct,
     boost_min_sales, updated_at, updated_by)
  values (btrim(p_brand), p_transport_pct, p_merchandise_pct, p_commission_normal_pct, p_commission_boost_pct,
          p_boost_min_gp_pct, p_boost_min_sales, now(), (select u.id from public.app_users u where u.id = auth.uid()))
  on conflict (brand) do update set
    transport_pct = excluded.transport_pct, merchandise_pct = excluded.merchandise_pct,
    commission_normal_pct = excluded.commission_normal_pct, commission_boost_pct = excluded.commission_boost_pct,
    boost_min_gp_pct = excluded.boost_min_gp_pct, boost_min_sales = excluded.boost_min_sales,
    updated_at = excluded.updated_at, updated_by = excluded.updated_by;
end;
$fn$;
revoke all on function public.project_cost_rate_set(text, numeric, numeric, numeric, numeric, numeric, numeric) from public, anon;
grant execute on function public.project_cost_rate_set(text, numeric, numeric, numeric, numeric, numeric, numeric) to authenticated;

-- Finance decides on the chart (Houzs event-accounts.ts: the account IS the type).
create or replace function public.gl_account_project_set(p_code text, p_needs_project boolean, p_project_row text)
returns void
language plpgsql security definer set search_path = public
as $fn$
begin
  perform public._project_money_gate();
  update public.gl_accounts
     set needs_project = coalesce(p_needs_project, false),
         project_row   = nullif(btrim(coalesce(p_project_row, '')), '')
   where code = p_code;
  if not found then
    raise exception 'That account is not on the chart.' using errcode = 'P0002', detail = 'account_not_found';
  end if;
end;
$fn$;
revoke all on function public.gl_account_project_set(text, boolean, text) from public, anon;
grant execute on function public.gl_account_project_set(text, boolean, text) to authenticated;

commit;
