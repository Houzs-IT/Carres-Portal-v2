-- 0775_drop_removed_module_objects.sql
-- ===========================================================================
-- The database half of the old-backend removal.
--
-- PR #2270 removed 36 Carres API routers whose screens were already gone
-- (Supply Chain, Service, Projects, HR/People, Settings, Issue Tracker,
-- Payments pages: #2257/#2266/#2268); Houzs's engine/ replaces them. The
-- owner asked for the old backend AND database to be cleaned so no stale
-- door can contradict the engine later. This file drops the tables and
-- functions that only that removed code used.
--
-- HOW "DEAD" WAS PROVEN (see the PR for the per-object list):
--   1. No caller in apps/api, apps/web, packages/shared, scripts, e2e,
--      e2e-kit, .github, supabase/functions (comments and tests excluded;
--      engine/ uses its own database and refuses this project's ref).
--   2. The final schema was rebuilt from every file in supabase/migrations
--      (last definition of each function, view, trigger, policy, table and
--      its alters). No kept function, view, trigger, policy, column default
--      or foreign key names any object dropped here. There is no pg_cron
--      job in the repository. A helper joins the list only when every
--      caller it has is dropped here too.
--
-- KEPT ON PURPOSE (on #2270's list, still needed):
--   stock_adjustments, stock_adjustment_units — Finance /stock-drops reads
--     them (apps/api/src/routes/finance/ledger.ts). stock_counts — the
--     foreign key target of stock_adjustments.count_id.
--   org_departments — org_positions.department_id references it.
--   org_duties — org_position_duties.duty_key references it; has_finance_
--     approver(), my_org_duties() and others read those duties.
--   warehouse_capabilities, warehouse_capability_grants — warehouse_
--     holds_capability() -> warehouse_settings_gate() still reads them.
--   project_activity — the trigger projects_record_activity() on the kept
--     projects table (Finance project money) writes it AND stamps
--     projects.updated_at; dropping it would need that trigger rewritten.
--
-- TRIGGER ON A KEPT TABLE: po_line_waits_for_new_models on
-- purchase_order_lines only refused a PO line while a purchase_request_
-- new_models row was unbuilt. That table's only writers are dropped, so the
-- trigger can never fire again; it is dropped with them.
--
-- RLS: no policy on a kept table changes. The policies dropped are the ones
-- ON the dropped tables, which go with their tables.
--
-- DATA: every row in this database is test data (CLAUDE.md §6). Nothing
-- dropped here is configuration that must survive go-live. Git history is
-- the copy of the definitions.
--
-- APPLY: governed manual path only. Run the rolled-back probe in the PR
-- first. Confirm this number against supabase_migrations.schema_migrations
-- (the repository and every branch end at 0774; the production tracker was
-- not readable when this was written).
-- ===========================================================================

begin;

-- 1. The one trigger on a kept table whose function is dropped below.
drop trigger if exists po_line_waits_for_new_models on public.purchase_order_lines;

-- 2. Functions (exact signatures; none is called by anything kept).
-- 0072_bd_convert_inquiry
drop function if exists public.bd_convert_inquiry(uuid);
-- 0250_bd_commission
drop function if exists public.hr_assign_dealer_bd(uuid, uuid);
-- 0254_hr_team_hierarchy
drop function if exists public.hr_set_position(uuid, uuid);
drop function if exists public.hr_set_staff_code(text, uuid, text);
-- 0259_org_departments
drop function if exists public.hr_team_source();
-- 0260_hr_duty_keys
drop function if exists public.hr_set_position_duty(uuid, text, boolean);
drop function if exists public.hr_set_reports_to(uuid, uuid);
-- 0265_hr_source_exclude_imported_archive
drop function if exists public.hr_commission_source(integer, integer);
-- 0269_hr_employee_master
drop function if exists public._hr_employee_filled(public.hr_employees);
drop function if exists public._hr_employment_status(public.hr_employees);
drop function if exists public._hr_is_self(public.hr_employees);
drop function if exists public.hr_add_employee(text, uuid);
drop function if exists public.hr_people_source();
drop function if exists public.hr_record_exit(uuid, date, text, text);
drop function if exists public.hr_reveal_employee_field(uuid, text);
drop function if exists public.hr_set_checklist_item(uuid, text, text, boolean);
-- 0272_commission_runs
drop function if exists public._commission_month_locked(integer, integer, text);
drop function if exists public.commission_add_adjustment(integer, integer, text, text, uuid, numeric, text, integer, integer, uuid, text);
drop function if exists public.commission_approve_run(uuid);
drop function if exists public.commission_mark_paid(uuid);
drop function if exists public.commission_run_detail(uuid);
drop function if exists public.commission_runs_list(integer);
drop function if exists public.commission_void_run(uuid, text);
-- 0276_hr_kpi_targets
drop function if exists public._kpi_is_self(uuid);
drop function if exists public._kpi_store_is_scoreable(uuid);
drop function if exists public.hr_delete_kpi_target(uuid);
drop function if exists public.hr_set_kpi_target(text, uuid, uuid, numeric, date, text);
drop function if exists public.hr_set_manual_actual(text, uuid, uuid, integer, integer, numeric, text);
drop function if exists public.hr_set_store_manager(uuid, uuid);
drop function if exists public.kpi_source(integer, integer);
-- 0278_hr_staff_comp
drop function if exists public._comp_is_self(uuid);
drop function if exists public.hr_delete_staff_comp(uuid);
drop function if exists public.hr_set_staff_comp(uuid, numeric, numeric, numeric, date, text);
drop function if exists public.staff_comp_source(integer, integer);
-- 0287_ready_stock_plan
drop function if exists public.ops_stock_plan_consolidate(uuid, text, integer, text);
drop function if exists public.ops_stock_plan_decide(uuid, text, text);
drop function if exists public.ops_stock_plan_open(date, text);
drop function if exists public.ops_stock_plan_propose(uuid, text, integer, text);
drop function if exists public.ops_stock_plan_set_final(uuid, text, integer);
-- 0290_ready_stock_urgent_lane
drop function if exists public.ops_stock_emergency_decide(uuid, text, integer, text);
drop function if exists public.ops_stock_emergency_mark_ordered(uuid);
drop function if exists public.ops_stock_emergency_raise(text, integer, text, text);
-- 0296_attribution_becomes_a_constraint
drop function if exists public.commission_close_month(integer, integer, text, jsonb, text);
-- 0297_run_state_drops_the_dead_count
drop function if exists public.commission_run_state(integer, integer, text);
-- 0331_the_locked_month_says_july_not_july_with_six_spaces
drop function if exists public._commission_assert_order_month_open(uuid);
-- 0366_the_unit_register_is_the_one_inventory_authority
drop function if exists public.ops_stock_set_thresholds(text, uuid, integer, integer);
-- 0368_one_question_one_number_and_bulk_is_not_bindable
drop function if exists public.operation_stock_alerts();
-- 0456_the_warehouse_site_states_its_details_hours_and_special_dates
drop function if exists public.warehouse_can_manage_settings();
drop function if exists public.warehouse_set_working_hours(uuid, jsonb);
-- 0457_the_warehouse_keeps_a_holiday_policy_a_calendar_and_its_access
drop function if exists public.warehouse_revoke_capability(text, uuid);
drop function if exists public.warehouse_set_holiday_policy(uuid, boolean, text, text, boolean, text, time without time zone, time without time zone);
-- 0458_a_warehouse_is_operated_by_a_warehouse_operator
drop function if exists public.warehouse_grant_capability(text, uuid);
drop function if exists public.warehouse_is_person(uuid);
-- 0473_the_refusal_names_the_unit_that_stopped_it
drop function if exists public.so_batch_reserve_ready_units(text, text, text, jsonb);
-- 0560_a_blank_answer_is_not_an_answer
drop function if exists public.commission_reopen_run(uuid, text);
drop function if exists public.warehouse_import_holiday_calendar(text, text, text, text, timestamp with time zone, jsonb);
drop function if exists public.warehouse_save_special_date(uuid, uuid, date, text, time without time zone, time without time zone, text);
drop function if exists public.warehouse_set_site_details(uuid, text, text, text, uuid, text, uuid, text);
-- 0586_the_operation_dashboard_reads_the_stages_that_exist
drop function if exists public.operation_dashboard_summary();
-- 0600_a_unit_on_a_purchase_order_can_be_reserved_for_a_sales_order
drop function if exists public.so_batch_save_ready_units(text, text, text, uuid, uuid, jsonb);
drop function if exists public.so_batch_use_po_units(text, text, text, uuid, uuid, text);
-- 0671_po_and_grn_duty_rotate_monthly_and_saturday_on_call_has_its_own_rota
drop function if exists public._workspace_on_call_eligible(uuid);
drop function if exists public.workspace_saturday_on_call_read(integer);
drop function if exists public.workspace_saturday_on_call_save_window(time without time zone, time without time zone, bigint);
drop function if exists public.workspace_saturday_on_call_set(date, uuid, uuid, text);
-- 0678_office_doors_count_the_office_calendar_people_keep_a_working_week_and_courier_dispatch_has_a_lead
drop function if exists public.hr_employee_detail(uuid);
drop function if exists public.hr_upsert_employee(uuid, jsonb);
-- 0695_a_forecast_purchase_is_asked_once_through_the_request_door
drop function if exists public.purchasing_forecast_submission(uuid);
-- 0698_purchase_requests_keep_their_approved_scope_through_execution
drop function if exists public.purchasing_submit_forecast_requests(uuid, date, uuid, jsonb);
-- 0701_sc_procurement_requires_qualified_case_remedy_approval
drop function if exists public.service_case_remedy_decide(uuid, jsonb);
drop function if exists public.service_case_remedy_propose(uuid, jsonb);
-- 0714_office_staff_adjust_transfer_and_count_stock
drop function if exists public._stock_move_refusal(public.ops_stock_items, uuid);
drop function if exists public.stock_adjust_units(uuid, text, uuid[], jsonb, uuid);
drop function if exists public.stock_count_open(uuid, boolean, text);
drop function if exists public.stock_count_record(uuid, text[], jsonb, boolean);
drop function if exists public.stock_transfer_cancel(uuid, text);
drop function if exists public.stock_transfer_units(uuid, uuid, uuid[], text);
-- 0716_office_staff_record_delivery_returns_and_mark_delivered_by_load_scan
drop function if exists public._delivery_order_exact_units(public.ops_delivery_orders);
drop function if exists public.delivery_load_scan(text);
drop function if exists public.delivery_return_record_lines(uuid, jsonb, uuid, text);
drop function if exists public.delivery_return_record(uuid, uuid[], uuid, text, jsonb);
drop function if exists public.delivery_return_set_refund_status(uuid, text);
-- 0719_office_staff_send_goods_to_customers_on_consignment
drop function if exists public._consignment_customer(uuid, jsonb);
drop function if exists public._consignment_note_holding(public.ops_stock_items);
drop function if exists public._consignment_out_refusal(public.ops_stock_items);
drop function if exists public.consignment_note_create(uuid, uuid, jsonb, uuid[], date, text, jsonb);
drop function if exists public.consignment_note_mark_sold(uuid[]);
drop function if exists public.consignment_note_payment_add(uuid, numeric, text, date, text, text);
drop function if exists public.consignment_note_payment_delete(uuid, uuid);
drop function if exists public.customer_consignment_order_create(uuid, jsonb, jsonb, text);
drop function if exists public.customer_consignment_payment_add(uuid, numeric, text, date, text, text);
drop function if exists public.customer_consignment_payment_delete(uuid, uuid);
drop function if exists public.customer_consignment_return_create(uuid, uuid[], text);
-- 0721_purchasing_sees_supplier_bills_and_a_used_sku_stays
drop function if exists public.purchasing_supplier_bill_draft(uuid);
drop function if exists public.purchasing_supplier_bill_list();
-- 0723_office_staff_plan_delivery_dates_and_trips_with_time_slots
drop function if exists public._delivery_plan_open_order(uuid);
drop function if exists public.delivery_plan_cancel(uuid, smallint, text);
drop function if exists public.delivery_plan_date(uuid, smallint, date, uuid, text, text);
drop function if exists public.delivery_plan_stop(uuid, smallint, smallint, text);
drop function if exists public.delivery_trip_day(public.ops_delivery_arrangements);
-- 0753_sales_orders_at_a_project
drop function if exists public.project_link_order(uuid, uuid);
-- 0772_a_delivered_line_takes_a_new_price_and_its_invoice_follows
drop function if exists public.order_line_price_after_do(uuid, numeric, text);
-- 0774_a_purchase_request_can_ask_for_a_model_the_catalog_does_not_have
drop function if exists public.purchasing_request_ask_new_model(uuid, text, text, integer);
drop function if exists public.purchasing_request_model_built(uuid, text);

-- 3. Tables. Their own indexes, triggers and RLS policies go with them. One
--    statement, no CASCADE: a foreign key from any KEPT table makes it fail.
drop table if exists
  public.ops_notes,
  public.purchase_snoozes,
  public.commission_milestones,
  public.commission_scheme_config,
  public.model_commission_rates,
  public.model_commission_tiers,
  public.staff_commission_rates,
  public.bd_commission_rates,
  public.bd_commission_config,
  public.bd_profiles,
  public.org_position_history,
  public.hr_checklist_items,
  public.hr_employee_documents,
  public.hr_employment_events,
  public.commission_adjustments,
  public.commission_run_lines,
  public.commission_runs,
  public.kpi_manual_actuals,
  public.kpi_targets,
  public.staff_comp,
  public.ops_stock_emergency_requests,
  public.warehouse_setting_changes,
  public.workspace_saturday_on_call,
  public.workspace_saturday_on_call_window,
  public.workspace_saturday_on_call_window_changes,
  public.stock_count_units,
  public.stock_transfer_units,
  public.stock_transfers,
  public.delivery_return_lines,
  public.consignment_note_payments,
  public.consignment_note_units,
  public.consignment_notes,
  public.customer_consignment_order_payments,
  public.customer_consignment_order_units,
  public.customer_consignment_orders,
  public.customer_consignment_return_units,
  public.customer_consignment_returns,
  public.delivery_regions,
  public.delivery_residence_rules,
  public.project_masters,
  public.project_team,
  public.project_checklist,
  public.project_checklist_template_items,
  public.project_checklist_templates,
  public.project_stock_transfers,
  public.purchase_request_new_models;

-- 4. Trigger functions, now that the triggers that used them are gone.
drop function if exists public.set_ops_notes_updated_at();   -- 0162_ops_notes_tasks
drop function if exists public._commission_guard_rate_write();   -- 0331_the_locked_month_says_july_not_july_with_six_spaces
drop function if exists public.project_stock_transfer_stamp();   -- 0757_a_project_records_its_stock_going_out_to_the_fair_and_back
drop function if exists public.project_stock_transfer_sync();   -- 0757_a_project_records_its_stock_going_out_to_the_fair_and_back
drop function if exists public.po_line_waits_for_new_models();   -- 0774_a_purchase_request_can_ask_for_a_model_the_catalog_does_not_have

-- 5. Sanity: nothing named above is left (an overload this file did not
--    know about stops the apply and rolls it back). Schema only, no rows.
do $check$
declare
  v_left text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_left
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = any (array[
      '_commission_assert_order_month_open', '_commission_guard_rate_write',
      '_commission_month_locked', '_comp_is_self', '_consignment_customer',
      '_consignment_note_holding', '_consignment_out_refusal', '_delivery_order_exact_units',
      '_delivery_plan_open_order', '_hr_employee_filled', '_hr_employment_status', '_hr_is_self',
      '_kpi_is_self', '_kpi_store_is_scoreable', '_stock_move_refusal',
      '_workspace_on_call_eligible', 'bd_convert_inquiry', 'commission_add_adjustment',
      'commission_approve_run', 'commission_close_month', 'commission_mark_paid',
      'commission_reopen_run', 'commission_run_detail', 'commission_run_state',
      'commission_runs_list', 'commission_void_run', 'consignment_note_create',
      'consignment_note_mark_sold', 'consignment_note_payment_add',
      'consignment_note_payment_delete', 'customer_consignment_order_create',
      'customer_consignment_payment_add', 'customer_consignment_payment_delete',
      'customer_consignment_return_create', 'delivery_load_scan', 'delivery_plan_cancel',
      'delivery_plan_date', 'delivery_plan_stop', 'delivery_return_record',
      'delivery_return_record_lines', 'delivery_return_set_refund_status', 'delivery_trip_day',
      'hr_add_employee', 'hr_assign_dealer_bd', 'hr_commission_source', 'hr_delete_kpi_target',
      'hr_delete_staff_comp', 'hr_employee_detail', 'hr_people_source', 'hr_record_exit',
      'hr_reveal_employee_field', 'hr_set_checklist_item', 'hr_set_kpi_target',
      'hr_set_manual_actual', 'hr_set_position', 'hr_set_position_duty', 'hr_set_reports_to',
      'hr_set_staff_code', 'hr_set_staff_comp', 'hr_set_store_manager', 'hr_team_source',
      'hr_upsert_employee', 'kpi_source', 'operation_dashboard_summary',
      'operation_stock_alerts', 'ops_stock_emergency_decide', 'ops_stock_emergency_mark_ordered',
      'ops_stock_emergency_raise', 'ops_stock_plan_consolidate', 'ops_stock_plan_decide',
      'ops_stock_plan_open', 'ops_stock_plan_propose', 'ops_stock_plan_set_final',
      'ops_stock_set_thresholds', 'order_line_price_after_do', 'po_line_waits_for_new_models',
      'project_link_order', 'project_stock_transfer_stamp', 'project_stock_transfer_sync',
      'purchasing_forecast_submission', 'purchasing_request_ask_new_model',
      'purchasing_request_model_built', 'purchasing_submit_forecast_requests',
      'purchasing_supplier_bill_draft', 'purchasing_supplier_bill_list',
      'service_case_remedy_decide', 'service_case_remedy_propose', 'set_ops_notes_updated_at',
      'so_batch_reserve_ready_units', 'so_batch_save_ready_units', 'so_batch_use_po_units',
      'staff_comp_source', 'stock_adjust_units', 'stock_count_open', 'stock_count_record',
      'stock_transfer_cancel', 'stock_transfer_units', 'warehouse_can_manage_settings',
      'warehouse_grant_capability', 'warehouse_import_holiday_calendar', 'warehouse_is_person',
      'warehouse_revoke_capability', 'warehouse_save_special_date',
      'warehouse_set_holiday_policy', 'warehouse_set_site_details',
      'warehouse_set_working_hours', 'workspace_saturday_on_call_read',
      'workspace_saturday_on_call_save_window', 'workspace_saturday_on_call_set'
     ]);
  if v_left is not null then
    raise exception '0775: functions still present: %', v_left;
  end if;

  select string_agg(c.relname, ', ') into v_left
    from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relname = any (array[
      'bd_commission_config', 'bd_commission_rates', 'bd_profiles', 'commission_adjustments',
      'commission_milestones', 'commission_run_lines', 'commission_runs',
      'commission_scheme_config', 'consignment_note_payments', 'consignment_note_units',
      'consignment_notes', 'customer_consignment_order_payments',
      'customer_consignment_order_units', 'customer_consignment_orders',
      'customer_consignment_return_units', 'customer_consignment_returns', 'delivery_regions',
      'delivery_residence_rules', 'delivery_return_lines', 'hr_checklist_items',
      'hr_employee_documents', 'hr_employment_events', 'kpi_manual_actuals', 'kpi_targets',
      'model_commission_rates', 'model_commission_tiers', 'ops_notes',
      'ops_stock_emergency_requests', 'org_position_history', 'project_checklist',
      'project_checklist_template_items', 'project_checklist_templates', 'project_masters',
      'project_stock_transfers', 'project_team', 'purchase_request_new_models',
      'purchase_snoozes', 'staff_commission_rates', 'staff_comp', 'stock_count_units',
      'stock_transfer_units', 'stock_transfers', 'warehouse_setting_changes',
      'workspace_saturday_on_call', 'workspace_saturday_on_call_window',
      'workspace_saturday_on_call_window_changes'
     ]);
  if v_left is not null then
    raise exception '0775: tables still present: %', v_left;
  end if;

  if exists (select 1 from pg_trigger
              where tgname = 'po_line_waits_for_new_models'
                and tgrelid = 'public.purchase_order_lines'::regclass) then
    raise exception '0775: trigger po_line_waits_for_new_models still present';
  end if;
end
$check$;

commit;
