-- 0753 local check (Weisiang's decision 2026-10-22: Sales Orders at a project, Houzs way;
-- Jess was not part of this decision).
-- LOCAL COPY ONLY — never production. Pipe through psql stdin into a database
-- with 0750 to 0753 applied and at least one dealer. One transaction, rolled back.
-- Prints `0753 check: PASS` or stops at the first failed expectation.
begin;
do $check$
declare
  v_op uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_p uuid;
  v_order uuid;
  v_before text;
  v_ok boolean;
begin
  -- An AutoCount order needs no salesperson (orders_salesperson_required).
  insert into orders (dealer_id, customer_name, customer_phone, source_system)
  values ((select id from dealers order by id limit 1), 'Projects 0753', '0123456789', 'autocount')
  returning id into v_order;
  select (to_jsonb(o) - 'updated_at')::text into v_before from orders o where id = v_order;

  insert into auth.users (id, email) values (v_op, 'projects-0753@carres.test'), (v_other, 'projects-0753b@carres.test');
  insert into app_users (id, email, name, role, status) values
    (v_op, 'projects-0753@carres.test', 'Projects 0753', 'operation', 'active'),
    (v_other, 'projects-0753b@carres.test', 'Projects 0753 HR', 'hr', 'active');
  insert into projects (code, name, brand, state, venue, start_date, end_date)
  values ('2026-12-SOLO-KL-MITEC-CARRES', 'KL [Carres] SOLO @ MITEC', 'Carres', 'Kuala Lumpur', 'MITEC', '2026-12-04', '2026-12-06')
  returning id into v_p;

  -- Someone outside Operation is refused.
  perform set_config('request.jwt.claim.sub', v_other::text, true);
  v_ok := false;
  begin
    perform project_link_order(v_order, v_p);
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: hr linked an order'; end if;

  -- Operation links, and only project_id changes.
  perform set_config('request.jwt.claim.sub', v_op::text, true);
  perform project_link_order(v_order, v_p);
  if (select project_id from orders where id = v_order) is distinct from v_p then raise exception 'FAIL: not linked'; end if;
  perform project_link_order(v_order, null);
  if (select (to_jsonb(o) - 'updated_at')::text from orders o where id = v_order) is distinct from v_before then
    raise exception 'FAIL: link and unlink changed another order column';
  end if;

  -- An archived project takes no orders.
  update projects set archived_at = now() where id = v_p;
  v_ok := false;
  begin
    perform project_link_order(v_order, v_p);
  exception when no_data_found then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: archived project took an order'; end if;

  -- An unknown order says so.
  v_ok := false;
  begin
    perform project_link_order(gen_random_uuid(), null);
  exception when no_data_found then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: unknown order went quiet'; end if;

  raise notice '0753 check: PASS';
end
$check$;
rollback;
