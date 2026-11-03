-- 0754 local check (Weisiang's decision 2026-10-22 and YH 3 Nov 2026, "all follow houzs":
-- a project's money comes from the books, Houzs way; Jess was not part of this decision).
-- LOCAL COPY ONLY — never production. Pipe through psql stdin into a database
-- with 0750 to 0754 applied. One transaction, rolled back.
-- Prints `0754 check: PASS` or stops at the first failed expectation.
begin;
do $check$
declare
  v_fin uuid := gen_random_uuid();
  v_op uuid := gen_random_uuid();
  v_p uuid;
  v_exp text;
  v_cash text;
  v_entry uuid;
  v_ok boolean;
  v_n integer;
  v_fn text;
begin
  insert into auth.users (id, email) values (v_fin, 'projects-0754f@carres.test'), (v_op, 'projects-0754o@carres.test');
  insert into app_users (id, email, name, role, status) values
    (v_fin, 'projects-0754f@carres.test', 'Projects 0754 Finance', 'finance', 'active'),
    (v_op, 'projects-0754o@carres.test', 'Projects 0754 Operation', 'operation', 'active');
  insert into projects (code, name, brand, state, venue, start_date, end_date)
  values ('2026-12-SOLO-KL-MITEC-CARRES', 'KL [Carres] SOLO @ MITEC', 'Carres', 'Kuala Lumpur', 'MITEC', '2026-12-04', '2026-12-06')
  returning id into v_p;
  select code into v_exp from gl_accounts where kind = 'EXPENSE' and not is_heading and is_active and not is_control order by code limit 1;
  select code into v_cash from gl_accounts where kind = 'ASSET' and not is_heading and is_active and not is_control order by code limit 1;

  -- Every function that carries a line's project names it.
  foreach v_fn in array array[
    'gl_post(text,text,date,text,jsonb)', 'supplier_bill_save_draft(uuid,uuid,text,date,jsonb,date,text,text)',
    'payment_voucher_save_draft(uuid,text,uuid,text,date,text,jsonb,jsonb,text,text,text,numeric)',
    'supplier_bill_confirm(uuid)', 'payment_voucher_approve(uuid)', 'supplier_bill_document(uuid)', 'payment_voucher_document(uuid)'] loop
    if pg_get_functiondef(('public.' || v_fn)::regprocedure) !~ 'project_id' then
      raise exception 'FAIL: % does not carry project_id', v_fn;
    end if;
  end loop;
  if pg_get_functiondef('public.supplier_bill_confirm(uuid)'::regprocedure) !~ 'fin_refuse_untagged_lines'
     or pg_get_functiondef('public.payment_voucher_approve(uuid)'::regprocedure) !~ 'fin_refuse_untagged_lines' then
    raise exception 'FAIL: confirm or approve does not refuse an untagged line';
  end if;

  -- Operation sees no money and changes none (Houzs: finance viewers only).
  perform set_config('request.jwt.claim.sub', v_op::text, true);
  select count(*) into v_n from project_money(null);
  if v_n <> 0 then raise exception 'FAIL: operation read project money'; end if;
  v_ok := false;
  begin
    perform project_money_line_add(v_p, 'cost', 'rental', 'Booth', 100, null);
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: operation added a money line'; end if;

  -- Finance marks the account; an untagged line on it is refused, a tagged one passes.
  perform set_config('request.jwt.claim.sub', v_fin::text, true);
  perform gl_account_project_set(v_exp, true, 'rental');
  v_ok := false;
  begin
    perform fin_refuse_untagged_lines(jsonb_build_array(jsonb_build_object('account_code', v_exp)));
  exception when others then v_ok := sqlerrm like '%needs its project%';
  end;
  if not v_ok then raise exception 'FAIL: an untagged line on a needs-project account passed'; end if;
  perform fin_refuse_untagged_lines(jsonb_build_array(jsonb_build_object('account_code', v_exp, 'project_id', v_p)));

  -- A project that is not on the list is refused.
  v_ok := false;
  begin
    perform fin_line_project(jsonb_build_object('project_id', 'nope'), 'Line 1');
  exception when others then v_ok := sqlerrm like '%not on the list%';
  end;
  if not v_ok then raise exception 'FAIL: a bad project passed'; end if;

  -- The ledger leg carries the project, and the books read it live.
  v_entry := gl_post('MANUAL', 'CHECK-0754', current_date, 'check 0754', jsonb_build_array(
    jsonb_build_object('account_code', v_exp, 'debit', 480, 'credit', 0, 'memo', 'Booth', 'department_type', 'OFFICE', 'project_id', v_p),
    jsonb_build_object('account_code', v_cash, 'debit', 0, 'credit', 480, 'department_type', 'OFFICE')));
  select count(*) into v_n from gl_entry_lines where entry_id = v_entry and project_id = v_p;
  if v_n <> 1 then raise exception 'FAIL: the ledger leg lost its project (% legs)', v_n; end if;
  select count(*) into v_n from project_books(array[v_p]) b where b.project_row = 'rental' and b.debit = 480 and not b.checked;
  if v_n <> 1 then raise exception 'FAIL: the books did not read the leg'; end if;

  -- Typed lines, Total Sales and the rate card.
  perform project_money_line_add(v_p, 'cost', 'setup', 'Carpet', 300, '2026-12-04');
  perform project_total_sales_set(v_p, 10000);
  perform project_cost_rate_set('Carres', 3, 1, 5, 7, 40, null);
  select count(*) into v_n from project_money(array[v_p]) m
   where m.total_sales = 10000 and jsonb_array_length(m.lines) = 1 and (m.rate ->> 'transport_pct')::numeric = 3;
  if v_n <> 1 then raise exception 'FAIL: project money did not read back'; end if;
  perform project_money_line_archive((select id from project_finance_lines where project_id = v_p));
  select count(*) into v_n from project_money(array[v_p]) m where jsonb_array_length(m.lines) = 0;
  if v_n <> 1 then raise exception 'FAIL: an archived line still shows'; end if;

  raise notice '0754 check: PASS';
end
$check$;
rollback;
