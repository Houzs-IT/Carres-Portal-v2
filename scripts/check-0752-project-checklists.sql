-- 0752 local check (Weisiang's decision 2026-10-22: project checklists, Houzs way;
-- Jess was not part of this decision).
-- LOCAL COPY ONLY — never production. Pipe through psql stdin into a database
-- with 0750, 0751 and 0752 applied. One transaction, rolled back. Prints
-- `0752 check: PASS` or stops at the first failed expectation.
begin;
do $check$
declare
  v_t1 uuid;
  v_t2 uuid;
  v_p uuid;
  v_ok boolean;
begin
  insert into project_checklist_templates (name, event_type) values ('Solo roadshow', 'solo') returning id into v_t1;
  -- A second active default for the same event type is refused.
  v_ok := false;
  begin
    insert into project_checklist_templates (name, event_type) values ('Solo again', 'solo');
  exception when unique_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: two active defaults for solo'; end if;
  -- Once the first is retired, another may take its place.
  update project_checklist_templates set active = false where id = v_t1;
  insert into project_checklist_templates (name, event_type) values ('Solo again', 'solo') returning id into v_t2;

  insert into project_checklist_template_items (template_id, section, seq, title, due_offset_days)
  values (v_t2, 'Before', 1, 'Book the lorry', -7);
  -- An offset past a year is refused.
  v_ok := false;
  begin
    insert into project_checklist_template_items (template_id, title, due_offset_days) values (v_t2, 'Too far', 400);
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: offset 400 saved'; end if;

  insert into projects (code, name, brand, state, venue, start_date, end_date)
  values ('2026-12-SOLO-KL-MITEC-CARRES', 'KL [Carres] SOLO @ MITEC', 'Carres', 'Kuala Lumpur', 'MITEC', '2026-12-04', '2026-12-06')
  returning id into v_p;
  insert into project_checklist (project_id, section, seq, title, due_offset_days)
  select v_p, section, seq, title, due_offset_days from project_checklist_template_items where template_id = v_t2;
  if (select count(*) from project_checklist where project_id = v_p and status = 'pending') <> 1 then
    raise exception 'FAIL: template task not copied as pending';
  end if;
  -- An unknown status is refused.
  v_ok := false;
  begin
    update project_checklist set status = 'late' where project_id = v_p;
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: status late saved'; end if;

  -- Removing a template item leaves the project's copied task alone.
  delete from project_checklist_template_items where template_id = v_t2;
  if (select count(*) from project_checklist where project_id = v_p) <> 1 then
    raise exception 'FAIL: project task went with the template item';
  end if;

  raise notice '0752 check: PASS';
end
$check$;
rollback;
