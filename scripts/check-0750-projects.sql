-- 0750 local check (Weisiang's decision 2026-10-22: Projects, Houzs way;
-- Jess was not part of this decision).
-- LOCAL COPY ONLY — never production. Pipe through psql stdin into a database
-- with 0750 applied. One transaction, rolled back. Prints
-- `0750 check: PASS` or stops at the first failed expectation.
begin;
do $check$
declare
  v_op uuid := gen_random_uuid();
  v_p uuid;
  v_ok boolean;
begin
  insert into auth.users (id, email) values (v_op, 'projects-0750@carres.test');
  insert into app_users (id, email, name, role, status) values (v_op, 'projects-0750@carres.test', 'Projects 0750', 'operation', 'active');
  perform set_config('request.jwt.claim.sub', v_op::text, true);

  insert into projects (code, name, brand, state, venue, start_date, end_date)
  values ('2026-12-SOLO-JOHOR-MALL-CARRES', 'JOHOR [Carres] SOLO @ Mall', 'Carres', 'Johor', 'Mall', '2026-12-04', '2026-12-06')
  returning id into v_p;
  if not exists (select 1 from project_activity where project_id = v_p and action = 'created' and to_value = 'pending') then
    raise exception 'FAIL: create not recorded';
  end if;

  update projects set stage = 'setup', status = 'confirmed' where id = v_p;
  if (select count(*) from project_activity where project_id = v_p and action in ('stage_change', 'status_change')) <> 2 then
    raise exception 'FAIL: stage and status changes not recorded';
  end if;

  update projects set archived_at = now() where id = v_p;
  if not exists (select 1 from project_activity where project_id = v_p and action = 'archived') then
    raise exception 'FAIL: archive not recorded';
  end if;

  -- An end date before the start date is refused.
  v_ok := false;
  begin
    update projects set end_date = '2026-12-01' where id = v_p;
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: end before start was saved'; end if;

  -- The same code twice is refused.
  v_ok := false;
  begin
    insert into projects (code, name, brand, state, venue, start_date, end_date)
    values ('2026-12-SOLO-JOHOR-MALL-CARRES', 'x', 'Carres', 'Johor', 'Mall', '2026-12-04', '2026-12-06');
  exception when unique_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: duplicate code saved'; end if;

  raise notice '0750 check: PASS';
end
$check$;
rollback;
