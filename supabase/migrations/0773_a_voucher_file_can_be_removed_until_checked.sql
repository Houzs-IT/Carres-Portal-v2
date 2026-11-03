-- 0773_a_voucher_file_can_be_removed_until_checked.sql
-- ===========================================================================
-- A payment voucher's file can be removed until the voucher is checked,
-- as Houzs does (YH, chat, 3 Nov 2026: "all follow houzs").
--
-- Houzs: DELETE /payment-vouchers/:id/files/:fileId takes the voucher write
-- permission and is refused once the voucher is checked ("evidence locks with
-- the document") or cancelled.
-- [code: Houzs-ERP backend/src/scm/routes/pv-files.ts:7-10,36-46,
--        backend/src/scm/lib/doc-files.ts:173-197]
--
-- Overturned Carres rule (Houzs wins, Mr Lim, WhatsApp, 22 Oct 2026; Jess was
-- not part of that ruling): ap_document_files is append-only (0477:363-381),
-- "files are evidence: they can be added, never removed". It stays append-only
-- for bills, credit and debit notes; only a draft or prepared voucher's file
-- may go, and only through the door below.
--
-- The stored object stays in the private ap-documents bucket: the bucket has
-- no delete policy (0477), and the file row is what every screen reads.
-- ===========================================================================

begin;

-- The trigger lets one row go when the door below names it for this
-- transaction; every other update or delete is still refused.
create or replace function public.ap_append_only()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if tg_op = 'DELETE' and tg_table_name = 'ap_document_files'
     and old.id::text = current_setting('carres.ap_file_remove', true) then
    return old;
  end if;
  raise exception 'a % row is never changed or deleted', tg_table_name
    using errcode = '42501', detail = 'append_only';
end;
$fn$;

alter table public.ap_document_events drop constraint if exists ap_document_events_action_check;
alter table public.ap_document_events add constraint ap_document_events_action_check
  check (action = any (array['created', 'edited', 'confirmed', 'prepared', 'checked', 'approved', 'rejected',
                             'cancelled', 'file_added', 'advance_applied', 'advance_taken_off', 'money_back',
                             'money_back_cancelled', 'credit_applied', 'credit_taken_off', 'month_close',
                             'file_removed']));

create or replace function public.ap_document_file_remove(p_voucher_id uuid, p_file_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_file   public.ap_document_files;
  v_status text;
begin
  -- the same gate as ap_document_file_add (0477), written NULL-safe.
  if not coalesce(public.app_role()::text in ('finance', 'principal'), false) then
    raise exception 'only finance removes a file from a voucher'
      using errcode = '42501', detail = 'not_finance';
  end if;

  select * into v_file from public.ap_document_files where id = p_file_id;
  if not found then
    raise exception 'That file does not exist.'
      using errcode = 'P0002', detail = 'file_missing';
  end if;
  if v_file.document_type <> 'PAYMENT_VOUCHER' or v_file.document_id is distinct from p_voucher_id then
    raise exception 'That file is not on this payment voucher.'
      using errcode = 'P0001', detail = 'file_not_removable';
  end if;

  select status into v_status from public.payment_vouchers where id = v_file.document_id for update;
  if v_status is null or v_status not in ('draft', 'prepared') then
    raise exception 'Only a draft or prepared voucher''s file can be removed.'
      using errcode = 'P0001', detail = 'evidence_locked';
  end if;

  perform set_config('carres.ap_file_remove', v_file.id::text, true);
  delete from public.ap_document_files where id = v_file.id;
  perform set_config('carres.ap_file_remove', '', true);

  perform public._ap_event('PAYMENT_VOUCHER', v_file.document_id, 'file_removed', v_file.file_name);
end;
$fn$;

revoke all on function public.ap_document_file_remove(uuid, uuid) from public, anon;
grant execute on function public.ap_document_file_remove(uuid, uuid) to authenticated;

commit;
