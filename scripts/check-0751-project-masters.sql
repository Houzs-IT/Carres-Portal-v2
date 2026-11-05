-- 0751 local check (Weisiang's decision 2026-10-22: Project Maintenance and the
-- project team, Houzs way; Jess was not part of this decision).
-- LOCAL COPY ONLY — never production. Pipe through psql stdin into a database
-- with 0750 and 0751 applied. One transaction, rolled back. Prints
-- `0751 check: PASS` or stops at the first failed expectation.
begin;
do $check$
declare
  v_op uuid := gen_random_uuid();
  v_p uuid;
  v_ok boolean;
begin
  insert into auth.users (id, email) values (v_op, 'projects-0751@carres.test');
  insert into app_users (id, email, name, role, status) values (v_op, 'projects-0751@carres.test', 'Projects 0751', 'operation', 'active');
  perform set_config('request.jwt.claim.sub', v_op::text, true);

  insert into project_masters (kind, name, state) values ('venue', 'MITEC', 'Kuala Lumpur');
  -- The same name in the same list, in any case, is refused.
  v_ok := false;
  begin
    insert into project_masters (kind, name) values ('venue', ' mitec ');
  exception when unique_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: duplicate venue saved'; end if;
  -- The same name in another list is fine.
  insert into project_masters (kind, name) values ('organizer', 'MITEC');
  -- An unknown kind is refused.
  v_ok := false;
  begin
    insert into project_masters (kind, name) values ('colour', 'Red');
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: unknown kind saved'; end if;

  insert into projects (code, name, brand, state, venue, start_date, end_date)
  values ('2026-12-SOLO-KL-MITEC-CARRES', 'KL [Carres] SOLO @ MITEC', 'Carres', 'Kuala Lumpur', 'MITEC', '2026-12-04', '2026-12-06')
  returning id into v_p;
  insert into project_team (project_id, user_id, role) values (v_p, v_op, 'onsite');
  insert into project_team (project_id, user_id, role) values (v_p, v_op, null);
  v_ok := false;
  begin
    insert into project_team (project_id, user_id, role) values (v_p, v_op, 'onsite');
  exception when unique_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: same person and role added twice'; end if;

  raise notice '0751 check: PASS';
end
$check$;
rollback;
