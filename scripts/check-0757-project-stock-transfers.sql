-- 0757 local check (YH 2026-11-03 "all follow houzs"; Weisiang's decision 2026-10-22:
-- stock out to the fair and back, Houzs project_stock_transfers; Jess was not part of either).
-- LOCAL COPY ONLY — never production. Pipe through psql stdin into a database with
-- 0750 to 0753 and 0757 applied. One transaction, rolled back.
-- Prints `0757 check: PASS` or stops at the first failed expectation.
begin;
do $check$
declare
  v_op uuid := gen_random_uuid();
  v_p uuid;
  v_t uuid;
  v_task record;
  v_ok boolean;
  v_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
  insert into auth.users (id, email) values (v_op, 'projects-0757@carres.test');
  insert into app_users (id, email, name, role, status) values (v_op, 'projects-0757@carres.test', 'Projects 0757', 'operation', 'active');
  perform set_config('request.jwt.claim.sub', v_op::text, true);
  insert into projects (code, name, brand, state, venue, start_date, end_date)
  values ('2026-12-SOLO-KL-MITEC-CARRES-0757', 'KL [Carres] SOLO @ MITEC', 'Carres', 'Kuala Lumpur', 'MITEC', '2026-12-04', '2026-12-06')
  returning id into v_p;

  -- Houzs: no date means today in Malaysia; the creator comes from the token, not the body.
  insert into project_stock_transfers (project_id, direction, notes, created_by, confirmed_by)
  values (v_p, 'out', 'Sofa set', gen_random_uuid(), gen_random_uuid()) returning id into v_t;
  if (select transferred_at from project_stock_transfers where id = v_t) <> v_today then raise exception 'FAIL: day did not default to today'; end if;
  if (select created_by from project_stock_transfers where id = v_t) is distinct from v_op then raise exception 'FAIL: created_by taken from the body'; end if;
  if (select confirmed_by from project_stock_transfers where id = v_t) is not null then raise exception 'FAIL: unconfirmed row carries a checker'; end if;

  -- One mirrored task, pending, titled with the day, no due offset.
  select * into v_task from project_checklist where stock_transfer_id = v_t;
  if v_task.id is null or v_task.status <> 'pending' or v_task.due_offset_days is not null
     or v_task.title <> 'Stock out, ' || to_char(v_today, 'FMDD Mon YYYY') then
    raise exception 'FAIL: mirror task wrong: %', row_to_json(v_task);
  end if;
  if not exists (select 1 from project_activity where project_id = v_p and action = 'stock_transfer_add' and to_value = 'out' and note = 'Sofa set') then
    raise exception 'FAIL: add not in the activity';
  end if;

  -- Confirm: stamped from the token, task done; a second confirm keeps the first stamp.
  update project_stock_transfers set confirmed_at = '2000-01-01', confirmed_by = gen_random_uuid() where id = v_t;
  if (select confirmed_by from project_stock_transfers where id = v_t) is distinct from v_op then raise exception 'FAIL: confirmed_by not from token'; end if;
  if (select confirmed_at from project_stock_transfers where id = v_t) < now() - interval '1 minute' then raise exception 'FAIL: confirmed_at taken from the body'; end if;
  select * into v_task from project_checklist where stock_transfer_id = v_t;
  if v_task.status <> 'done' or v_task.completed_by is distinct from v_op then raise exception 'FAIL: task not done on confirm'; end if;
  if not exists (select 1 from project_activity where project_id = v_p and action = 'stock_transfer_confirm') then raise exception 'FAIL: confirm not logged'; end if;

  -- Unconfirm: task back to pending, checker cleared.
  update project_stock_transfers set confirmed_at = null where id = v_t;
  select * into v_task from project_checklist where stock_transfer_id = v_t;
  if v_task.status <> 'pending' or v_task.completed_by is not null then raise exception 'FAIL: task not reopened'; end if;
  if (select confirmed_by from project_stock_transfers where id = v_t) is not null then raise exception 'FAIL: checker kept on unconfirm'; end if;
  if not exists (select 1 from project_activity where project_id = v_p and action = 'stock_transfer_unconfirm') then raise exception 'FAIL: unconfirm not logged'; end if;

  -- Archive (Houzs DELETE): the transfer stays, its task goes.
  update project_stock_transfers set archived_at = now() where id = v_t;
  if not exists (select 1 from project_stock_transfers where id = v_t) then raise exception 'FAIL: transfer row deleted'; end if;
  if exists (select 1 from project_checklist where stock_transfer_id = v_t) then raise exception 'FAIL: mirror task kept after archive'; end if;

  -- A return on a given day; a bad direction and a foreign path are refused.
  insert into project_stock_transfers (project_id, direction, transferred_at) values (v_p, 'return', '2026-12-07') returning id into v_t;
  if (select title from project_checklist where stock_transfer_id = v_t) <> 'Stock return, 7 Dec 2026' then raise exception 'FAIL: return title'; end if;
  v_ok := false;
  begin
    insert into project_stock_transfers (project_id, direction) values (v_p, 'in');
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: direction in accepted'; end if;
  v_ok := false;
  begin
    insert into project_stock_transfers (project_id, direction, record_path) values (v_p, 'out', '../etc/passwd');
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: bad record path accepted'; end if;

  -- Row security and grants: no delete right, RLS on, helpers not callable.
  if has_table_privilege('authenticated', 'public.project_stock_transfers', 'DELETE') then raise exception 'FAIL: authenticated may delete transfers'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.project_stock_transfers'::regclass) then raise exception 'FAIL: RLS off'; end if;
  if has_function_privilege('authenticated', 'public.project_stock_transfer_sync()', 'EXECUTE') then raise exception 'FAIL: sync callable'; end if;
  if not exists (select 1 from storage.buckets where id = 'project-stock-records' and public = false) then raise exception 'FAIL: bucket missing or public'; end if;

  raise notice '0757 check: PASS';
end
$check$;
rollback;
