-- Carres engine database: Team (Directory, Departments, Titles, Roles & Permissions) and the Kelana Jaya
-- showroom (owner decisions 13 Nov 2026).
--
-- WHY. Staff sign in through the Carres portal; carres/sso.ts finds the engine account by email and makes one on
-- first use with a starting role and no department or title. So Team showed only the people who had already
-- signed in, with no structure, and the engine held none of Houzs's roles or titles to give them. The owner named
-- Carres's four departments, the real staff (shared and test accounts are NOT brought in) and their titles, and a
-- second showroom.
--
-- WHAT.
--   1 Roles: Houzs's roles (from Houzs's masked local copy, roles only, no people), each added only when no role of
--     that name exists. Not copied: "HR" and "New Member (no access)", because carres/sso.ts makes its own HR and
--     "New member" starting roles by name and a Houzs copy under the name "HR" would change what a new HR account
--     starts with. The SSO-made "Owner" (full access) is kept as it is.
--   2 Departments: Management, Operation, Warehouse, Business Development (the one engine company, Carres).
--   3 Titles (positions): Houzs's titles, each placed in the Carres department matching its Houzs one (Houzs
--     Operation's warehouse-floor titles in Warehouse, Sales in Business Development, HR/Finance/IT in none), with
--     their access policy and actions rows; plus Carres's own COO, Administration Assistant and Business
--     Development. "Owner" is Houzs's Owner title.
--   4 Members, matched by email (lower case, as sso.ts stores and looks it up), so a first portal visit LINKS to
--     the row made here instead of making a second one. A new row starts on its department's role:
--       Management -> the full-access role (Owner) . Operation -> Ops Exec . Warehouse -> Storekeeper .
--       Business Development -> BD Exec.
--     An existing row keeps the role the owner gave it, unless it is still on sso.ts's "New member" starting role
--     (someone who signed in before this ran), which moves to the department's role. Department and title are set;
--     a name still equal to the email (what sso.ts writes) becomes the person's name. Khor Yee and Samantha are
--     disabled, as in the portal. principal@carres.com (a shared account) is not touched.
--   5 Warehouse KJ-SR "Kelana Jaya Showroom" (showroom, Selangor; street unknown, left blank for the owner), not
--     default and not in the state to warehouse mapping.
--
-- RE-RUN: safe; a second run changes nothing. No row count of the target is asserted.
-- REVERSAL: none automatic (data). Remove rows by hand by email / name / slug / code if ever needed.

do $guard$ begin
  if not exists (select 1 from public.companies where code = 'HOUZS') then
    raise exception 'Carres team: the engine company (code HOUZS) is missing; nothing was changed';
  end if;
end $guard$;

-- 1 . Roles copied from Houzs (added only when the name is new)
insert into public.roles (name, description, permissions, is_system, scope_to_pic)
select r.name, r.description, r.permissions, r.is_system, r.scope_to_pic
  from jsonb_to_recordset($j$
[{"name":"Owner","description":"Full access to everything, including team and roles","permissions":"[\"*\", \"agreement.approve\", \"projects.approve\", \"scm.amendment.approve_delivery\", \"scm.amendment.approve_lines\", \"scm.amendment.approve_price\", \"scm.po_amendment.approve\", \"stock_in.approve\", \"stock_transfer.approve\"]","is_system":1,"scope_to_pic":0},
{"name":"Driver","description":"Delivery driver. Driver-app access (clock in/out, own trips) + view event calendar & projects, download project documents, and upload setup/dismantle photos for projects they're crewed on.","permissions":"[\"projects.checklist.tick\"]","is_system":0,"scope_to_pic":0},
{"name":"Helper","description":"Setup/dismantle helper. Same as driver — view calendar & projects, download documents, upload setup/dismantle photos for assigned projects.","permissions":"[\"projects.checklist.tick\", \"projects.read\"]","is_system":0,"scope_to_pic":0},
{"name":"Super Admin","description":null,"permissions":"[\"*\"]","is_system":1,"scope_to_pic":0},
{"name":"Sales Person","description":"Showroom / delivery staff — registers service cases and captures evidence","permissions":"[\"service_cases.read\", \"service_cases.create\", \"projects.read\", \"sales.read\", \"sales.write\", \"sales.manage\", \"projects.chat\", \"projects.write\"]","is_system":0,"scope_to_pic":1},
{"name":"Sales Director","description":"Sales PIC. Owns projects assigned to them as PIC: can chat, tick checklist items, and log sales entries. Cannot edit project configuration, finance, or archive. Their direct reports inherit visibility of any project they PIC, can view calender.","permissions":"[\"projects.chat\",\"projects.checklist.tick\",\"projects.read\",\"projects.write\",\"sales.read\",\"sales.write\",\"scm.amendment.approve_price\",\"scm.so_cancel.approve_l1\",\"service_cases.create\",\"service_cases.read\",\"stock_in.approve\",\"stock_transfer.approve\",\"users.read\",\"scm.product_request.create\"]","is_system":0,"scope_to_pic":0},
{"name":"Logistic","description":"Logistics — arranges setup/dismantle crew + delivery; views calendar, projects, balance & overdue.","permissions":"[\"fleet.read\",\"projects.checklist.tick\",\"projects.read\",\"projects.write\",\"sales.read\",\"sales.write\",\"scm.access\",\"scm.amendment.approve_delivery\",\"scm.amendment.approve_so\",\"scm.amendment.supplier_confirm\",\"scm.payment_request.create\",\"scm.payment.backdate.approve\",\"scm.so.view_all\",\"service_cases.manage\",\"service_cases.read\",\"users.read\",\"scm.so.edit_after_do\"]","is_system":0,"scope_to_pic":0},
{"name":"BD Exec","description":"projects, trigger, team, sales team, sales entries","permissions":"[\"agreement.approve\", \"fleet.read\", \"projects.approve\", \"projects.chat\", \"projects.checklist.tick\", \"projects.finance.view\", \"projects.manage\", \"projects.read\", \"projects.write\", \"roles.read\", \"sales.manage\", \"sales.read\", \"sales.write\", \"scm.access\", \"scm.payment_request.create\", \"scm.so.view_all\", \"service_cases.manage\", \"service_cases.read\", \"service_cases.write\", \"stock_in.approve\", \"stock_transfer.approve\", \"udf.manage\", \"users.read\"]","is_system":0,"scope_to_pic":0},
{"name":"Finance","description":"View-only access to projects calendar, project details, and project finances.","permissions":"[\"projects.finance.view\", \"projects.read\", \"scm.access\", \"scm.currency.manage\", \"scm.payment_request.create\", \"scm.payment_voucher.cancel\", \"scm.payment_voucher.check\", \"scm.payment_voucher.create\", \"scm.payment_voucher.post\", \"scm.payment_voucher.write\", \"scm.payment.backdate\", \"scm.so_payment.amend\", \"scm.so.view_all\"]","is_system":0,"scope_to_pic":0},
{"name":"Storekeeper","description":"Store/warehouse staff. Same access as drivers & helpers — view calendar & projects, download project documents, upload setup/dismantle photos for assigned projects.","permissions":"[\"projects.checklist.tick\", \"projects.read\", \"scm.access\", \"scm.payment_request.create\"]","is_system":0,"scope_to_pic":0},
{"name":"Ops Exec","description":"Operations executive — coordinates projects/logistics/service cases (page access via Ops Executive position).","permissions":"[\"fleet.read\", \"projects.chat\", \"projects.checklist.tick\", \"projects.read\", \"scm.access\", \"scm.payment_request.create\", \"scm.so.view_all\", \"service_cases.manage\", \"service_cases.read\", \"service_cases.write\"]","is_system":0,"scope_to_pic":0},
{"name":"Purchaser","description":"Purchasing role — handles PURCHASER checklist tasks (e.g. Stock Out Transfer Record), shows them in My Pending Tasks. Ops Exec access + projects.write + purchase_orders.read.","permissions":"[\"announcements.read\", \"fleet.read\", \"projects.chat\", \"projects.checklist.tick\", \"projects.read\", \"scm.access\", \"scm.amendment.approve_lines\", \"scm.amendment.approve_so\", \"scm.amendment.supplier_confirm\", \"scm.payment_request.create\", \"scm.po_amendment.approve\", \"scm.product_request.approve\", \"scm.product_request.create\", \"scm.so_cancel.approve_l2\", \"scm.so.override_po_processing_date\", \"scm.so.remove_processing_date\", \"scm.so.view_all\", \"service_cases.manage\", \"service_cases.read\", \"service_cases.write\"]","is_system":0,"scope_to_pic":0},
{"name":"Calendar Viewer","description":"View the events calendar (and project info) only — no editing, no finances","permissions":"[\"projects.read\"]","is_system":0,"scope_to_pic":0},
{"name":"IT Admin (Agreement Approver)","description":"Full admin minus stock approvals - approves Agreement/Quotation + 3D final (owner matrix 2026-07-21)","permissions":"[\"service_cases.read\", \"service_cases.create\", \"service_cases.write\", \"service_cases.manage\", \"logs.read\", \"fleet.read\", \"fleet.write\", \"projects.read\", \"projects.chat\", \"projects.checklist.tick\", \"projects.write\", \"agreement.approve\", \"projects.manage\", \"sales.read\", \"sales.write\", \"sales.manage\", \"scm.access\", \"scm.config.write\", \"scm.so.price_override\", \"scm.so.view_all\", \"scm.so.attribute_other\", \"scm.so.remove_processing_date\", \"scm.amendment.create\", \"scm.amendment.approve_lines\", \"scm.amendment.approve_delivery\", \"scm.amendment.supplier_confirm\", \"scm.amendment.approve_so\", \"scm.amendment.approve_po\", \"scm.po_amendment.create\", \"scm.po_amendment.approve\", \"scm.payment_voucher.create\", \"scm.payment_voucher.write\", \"scm.payment_voucher.post\", \"scm.payment_voucher.cancel\", \"scm.currency.manage\", \"scm.hr.read\", \"scm.hr.manage\", \"scm.hr.close\", \"scm.hr.reopen\", \"mail_center.read\", \"mail_center.manage\", \"announcements.read\", \"announcements.write\", \"udf.manage\", \"settings.manage\", \"users.read\", \"users.manage\", \"roles.read\", \"roles.manage\"]","is_system":0,"scope_to_pic":0},
{"name":"IT Admin (with approval)","description":"Full admin minus every checklist approval (owner matrix 2026-07-21)","permissions":"[\"projects.manage\", \"scm.access\", \"scm.so.view_all\", \"scm.hr.reopen\", \"fleet.read\", \"service_cases.write\", \"sales.write\", \"roles.manage\", \"settings.manage\", \"projects.read\", \"scm.amendment.supplier_confirm\", \"scm.hr.read\", \"logs.read\", \"scm.amendment.approve_po\", \"mail_center.read\", \"service_cases.read\", \"scm.payment_voucher.post\", \"scm.config.write\", \"scm.amendment.approve_lines\", \"scm.hr.manage\", \"scm.currency.manage\", \"fleet.write\", \"scm.po_amendment.approve\", \"projects.checklist.tick\", \"announcements.read\", \"service_cases.create\", \"roles.read\", \"service_cases.manage\", \"udf.manage\", \"scm.amendment.approve_delivery\", \"scm.hr.close\", \"announcements.write\", \"scm.payment_voucher.cancel\", \"users.read\", \"scm.so.price_override\", \"projects.write\", \"scm.po_amendment.create\", \"mail_center.manage\", \"scm.so.attribute_other\", \"users.manage\", \"projects.chat\", \"sales.manage\", \"scm.amendment.create\", \"sales.read\", \"scm.amendment.approve_so\", \"scm.so.remove_processing_date\", \"scm.payment_voucher.write\", \"scm.payment_voucher.create\"]","is_system":0,"scope_to_pic":0},
{"name":"Managing Director","description":null,"permissions":"[\"service_cases.read\",\"service_cases.create\",\"service_cases.write\",\"service_cases.manage\",\"service_cases.approve\",\"logs.read\",\"fleet.read\",\"fleet.write\",\"projects.read\",\"projects.chat\",\"projects.checklist.tick\",\"projects.write\",\"projects.approve\",\"stock_transfer.approve\",\"stock_in.approve\",\"agreement.approve\",\"projects.manage\",\"projects.finance.view\",\"sales.read\",\"sales.write\",\"sales.manage\",\"scm.access\",\"scm.config.write\",\"scm.so.price_override\",\"scm.so.view_all\",\"scm.so.attribute_other\",\"scm.so.remove_processing_date\",\"scm.amendment.create\",\"scm.amendment.approve_lines\",\"scm.amendment.approve_delivery\",\"scm.amendment.supplier_confirm\",\"scm.amendment.approve_po\",\"scm.po_amendment.create\",\"scm.po_amendment.approve\",\"scm.payment_voucher.create\",\"scm.payment_voucher.write\",\"scm.payment_voucher.cancel\",\"scm.payment_voucher.post\",\"scm.payment_voucher.check\",\"scm.payment_voucher.approve\",\"scm.stock_take.supervise\",\"scm.currency.manage\",\"scm.hr.read\",\"scm.hr.manage\",\"scm.hr.close\",\"scm.hr.reopen\",\"scm.autocount.read\",\"scm.autocount.requeue\",\"mail_center.read\",\"mail_center.manage\",\"announcements.read\",\"announcements.write\",\"announcements.approve\",\"udf.manage\",\"settings.manage\",\"users.read\",\"users.manage\",\"roles.read\",\"roles.manage\",\"scm.amendment.approve_so\",\"scm.so_cancel.approve_l1\",\"scm.so_cancel.approve_l2\",\"scm.so_payment.amend\",\"scm.changelog.read\",\"scm.venture_portal.read\",\"scm.venture_portal.manage\",\"memos.manage\"]","is_system":0,"scope_to_pic":0},
{"name":"PG WH Assistant","description":null,"permissions":"[\"service_cases.read\",\"projects.read\",\"projects.checklist.tick\",\"sales.read\"]","is_system":0,"scope_to_pic":0},
{"name":"IT Admin","description":null,"permissions":"[\"announcements.read\",\"announcements.write\",\"fleet.read\",\"fleet.write\",\"logs.read\",\"mail_center.manage\",\"mail_center.read\",\"projects.chat\",\"projects.checklist.tick\",\"projects.manage\",\"projects.read\",\"projects.write\",\"roles.manage\",\"roles.read\",\"sales.manage\",\"sales.read\",\"sales.write\",\"scm.access\",\"scm.amendment.create\",\"scm.config.write\",\"scm.currency.manage\",\"scm.hr.manage\",\"scm.hr.read\",\"scm.payment_request.create\",\"scm.payment_voucher.create\",\"scm.payment_voucher.write\",\"scm.po_amendment.create\",\"scm.so.attribute_other\",\"scm.so.remove_processing_date\",\"scm.so.view_all\",\"service_cases.create\",\"service_cases.manage\",\"service_cases.read\",\"service_cases.write\",\"settings.manage\",\"udf.manage\",\"users.manage\",\"users.read\",\"it.view\"]","is_system":0,"scope_to_pic":0},
{"name":"Sales Director (Price Approver)","description":"Sales Director who also approves 2990 price-only SO amendments (scm.amendment.approve_price). Clone of the Sales Director role plus the price key; keep in step by hand. Owner 2026-09-21.","permissions":"[\"projects.chat\",\"projects.checklist.tick\",\"projects.read\",\"projects.write\",\"sales.read\",\"sales.write\",\"scm.amendment.approve_price\",\"scm.so_cancel.approve_l1\",\"service_cases.create\",\"service_cases.read\",\"stock_in.approve\",\"stock_transfer.approve\",\"users.read\",\"scm.product_request.create\"]","is_system":0,"scope_to_pic":0},
{"name":"Finance Executive","description":null,"permissions":"[\"projects.finance.view\",\"projects.read\",\"scm.access\",\"scm.autocount.read\",\"scm.changelog.read\",\"scm.currency.manage\",\"scm.payment_request.create\",\"scm.payment_voucher.cancel\",\"scm.payment_voucher.check\",\"scm.payment_voucher.create\",\"scm.payment_voucher.post\",\"scm.payment_voucher.write\",\"scm.payment.backdate\",\"scm.so_payment.amend\",\"scm.so.view_all\",\"scm.stock_take.supervise\",\"service_cases.read\"]","is_system":0,"scope_to_pic":0},
{"name":"Logistic Admin","description":"Logistics admin — same ERP permissions as Logistic; the \"Admin\" in the name gives ADMIN in Houzs Connect (see all chats, reply, payments).","permissions":"[\"fleet.read\",\"projects.checklist.tick\",\"projects.read\",\"projects.write\",\"sales.read\",\"sales.write\",\"scm.access\",\"scm.amendment.approve_delivery\",\"scm.amendment.approve_so\",\"scm.amendment.supplier_confirm\",\"scm.payment_request.create\",\"scm.payment.backdate.approve\",\"scm.so.view_all\",\"service_cases.manage\",\"service_cases.read\",\"users.read\",\"scm.so.edit_after_do\",\"scm.so.edit_price_after_do\"]","is_system":0,"scope_to_pic":0},
{"name":"Marketing","description":null,"permissions":"[\"sales.read\",\"sales.write\",\"sales.manage\"]","is_system":0,"scope_to_pic":0}]
$j$::jsonb) as r(name text, description text, permissions text, is_system bigint, scope_to_pic bigint)
 where not exists (select 1 from public.roles x where x.name = r.name);

-- 2 . Departments. The reference-number code is given only when no other department holds it already.
insert into public.departments (name, description, color, sort_order, code)
select d.name, null, d.color, d.sort_order,
       case when exists (select 1 from public.departments x where upper(x.code) = d.code) then null else d.code end
  from (values ('Management', '8b5cf6', 10, 'MGT'), ('Operation', '3b82f6', 20, 'OPS'),
               ('Warehouse', 'f59e0b', 30, 'WH'), ('Business Development', 'ec4899', 40, 'BD'))
       as d(name, color, sort_order, code)
 where not exists (select 1 from public.departments x where x.name = d.name);

-- 3 . Titles: Houzs's, then Carres's own
create temporary table carres_titles on commit drop as
select p.slug, p.name, p.level, p.sort_order, p.active, p.department, p.policy, p.capabilities
  from jsonb_to_recordset($j$
[{"slug":"super_admin","name":"Super Admin","level":10,"sort_order":10,"active":1,"department":"Management","policy":{"cohort":"god","profile":null,"can_move_money":1,"can_write_config":1,"is_fleet":0,"duty":"management"},"capabilities":[]},
{"slug":"hr_manager","name":"HR Manager","level":20,"sort_order":30,"active":1,"department":null,"policy":{"cohort":"full","profile":null,"can_move_money":0,"can_write_config":0,"is_fleet":0,"duty":"other"},"capabilities":[]},
{"slug":"finance_manager","name":"Finance Manager","level":20,"sort_order":20,"active":1,"department":null,"policy":{"cohort":"full","profile":null,"can_move_money":1,"can_write_config":0,"is_fleet":0,"duty":"finance"},"capabilities":["scm.invoice.issue"]},
{"slug":"sales_director","name":"Sales Director","level":10,"sort_order":10,"active":1,"department":"Business Development","policy":{"cohort":"sales","profile":"director","can_move_money":0,"can_write_config":0,"is_fleet":0,"duty":"other"},"capabilities":[]},
{"slug":"sales_manager","name":"Sales Manager","level":15,"sort_order":15,"active":1,"department":"Business Development","policy":{"cohort":"sales","profile":"rep","can_move_money":0,"can_write_config":0,"is_fleet":0,"duty":"other"},"capabilities":[]},
{"slug":"sales_executive","name":"Sales Executive","level":20,"sort_order":20,"active":1,"department":"Business Development","policy":{"cohort":"sales","profile":"rep","can_move_money":0,"can_write_config":0,"is_fleet":0,"duty":"other"},"capabilities":[]},
{"slug":"ops_director","name":"Operation Manager","level":10,"sort_order":10,"active":1,"department":"Operation","policy":{"cohort":"full","profile":null,"can_move_money":0,"can_write_config":1,"is_fleet":0,"duty":"other"},"capabilities":["scm.do.dispatch","scm.do.load","scm.do.revert","scm.grn.post"]},
{"slug":"ops_executive","name":"Operation Executive","level":20,"sort_order":20,"active":1,"department":"Operation","policy":{"cohort":"full","profile":null,"can_move_money":0,"can_write_config":1,"is_fleet":0,"duty":"other"},"capabilities":["scm.do.dispatch","scm.do.load","scm.do.revert","scm.grn.post"]},
{"slug":"purchasing","name":"Procurement/Purchasing","level":25,"sort_order":40,"active":1,"department":"Operation","policy":{"cohort":"full","profile":null,"can_move_money":0,"can_write_config":1,"is_fleet":0,"duty":"purchasing"},"capabilities":["scm.grn.post"]},
{"slug":"logistic","name":"Logistic Admin","level":25,"sort_order":30,"active":1,"department":"Operation","policy":{"cohort":"full","profile":null,"can_move_money":0,"can_write_config":1,"is_fleet":0,"duty":"other"},"capabilities":["scm.do.dispatch","scm.do.load","scm.invoice.issue"]},
{"slug":"storekeeper","name":"Storekeeper","level":25,"sort_order":90,"active":1,"department":"Warehouse","policy":{"cohort":"restricted","profile":"storekeeper","can_move_money":0,"can_write_config":0,"is_fleet":0,"duty":"warehouse"},"capabilities":["scm.do.load"]},
{"slug":"driver","name":"Driver","level":30,"sort_order":60,"active":1,"department":"Warehouse","policy":{"cohort":"restricted","profile":"driver_helper","can_move_money":0,"can_write_config":0,"is_fleet":1,"duty":"driver"},"capabilities":["scm.do.dispatch"]},
{"slug":"storekeeper_supervisor","name":"Storekeeper Supervisor","level":100,"sort_order":70,"active":1,"department":"Warehouse","policy":{"cohort":"restricted","profile":"storekeeper_supervisor","can_move_money":0,"can_write_config":0,"is_fleet":0,"duty":"other"},"capabilities":["scm.do.load"]},
{"slug":"calendar-viewer","name":"Calendar Viewer","level":100,"sort_order":100,"active":1,"department":"Management","policy":{"cohort":"restricted","profile":"calendar_viewer","can_move_money":0,"can_write_config":0,"is_fleet":0,"duty":"other"},"capabilities":[]},
{"slug":"owner","name":"Owner","level":5,"sort_order":5,"active":1,"department":"Management","policy":{"cohort":"god","profile":null,"can_move_money":1,"can_write_config":1,"is_fleet":0,"duty":"management"},"capabilities":[]},
{"slug":"it_developer_executive","name":"IT Developer Executive","level":20,"sort_order":0,"active":1,"department":null,"policy":{"cohort":"full","profile":null,"can_move_money":0,"can_write_config":0,"is_fleet":0,"duty":"other"},"capabilities":[]},
{"slug":"outsource_transporter","name":"Outsource Transporter","level":30,"sort_order":0,"active":1,"department":"Warehouse","policy":{"cohort":"restricted","profile":"driver_helper","can_move_money":0,"can_write_config":0,"is_fleet":0,"duty":"other"},"capabilities":[]},
{"slug":"warehouse_crew_kl","name":"Warehouse Crew KL","level":25,"sort_order":0,"active":1,"department":"Warehouse","policy":{"cohort":"restricted","profile":"storekeeper","can_move_money":0,"can_write_config":0,"is_fleet":0,"duty":"warehouse"},"capabilities":[]},
{"slug":"managing_director","name":"Managing Director","level":10,"sort_order":8,"active":1,"department":"Management","policy":{"cohort":"god","profile":null,"can_move_money":1,"can_write_config":1,"is_fleet":0,"duty":"management"},"capabilities":[]},
{"slug":"pg_wh_assistant","name":"PG WH Assistant","level":100,"sort_order":100,"active":1,"department":"Warehouse","policy":{"cohort":"full","profile":null,"can_move_money":0,"can_write_config":1,"is_fleet":0,"duty":"other"},"capabilities":[]},
{"slug":"finance_executive","name":"Finance Executive","level":100,"sort_order":100,"active":1,"department":null,"policy":{"cohort":"full","profile":null,"can_move_money":1,"can_write_config":0,"is_fleet":0,"duty":"finance"},"capabilities":[]}]
$j$::jsonb) as p(slug text, name text, level int, sort_order int, active int, department text, policy jsonb, capabilities jsonb)
union all
select * from (values
  ('coo', 'COO', 10, 8, 1, 'Management', null::jsonb, '[]'::jsonb),
  ('administration_assistant', 'Administration Assistant', 25, 50, 1, 'Operation', null::jsonb, '[]'::jsonb),
  ('business_development', 'Business Development', 20, 20, 1, 'Business Development', null::jsonb, '[]'::jsonb)
) as c(slug, name, level, sort_order, active, department, policy, capabilities);

-- A title is the same title when its slug or its name matches; only a missing one is added.
insert into public.positions (department_id, slug, name, level, sort_order, active)
select (select d.id from public.departments d where d.name = t.department order by d.id limit 1),
       t.slug, t.name, t.level, t.sort_order, t.active
  from carres_titles t
 where not exists (select 1 from public.positions x where x.slug = t.slug or lower(x.name) = lower(t.name));
-- A matching title with no department yet gets the Carres one; one already placed stays where it is.
update public.positions x
   set department_id = (select d.id from public.departments d where d.name = t.department order by d.id limit 1)
  from carres_titles t
 where (x.slug = t.slug or lower(x.name) = lower(t.name)) and x.department_id is null and t.department is not null;
-- Access policy and actions rows travel with Houzs's titles; a title that already has a policy keeps it.
insert into public.position_policy (position_id, cohort, profile, can_move_money, can_write_config, is_fleet, duty)
select x.id, t.policy->>'cohort', t.policy->>'profile', (t.policy->>'can_move_money')::int,
       (t.policy->>'can_write_config')::int, (t.policy->>'is_fleet')::int, t.policy->>'duty'
  from carres_titles t join public.positions x on x.slug = t.slug
 where t.policy is not null
on conflict (position_id) do nothing;
insert into public.position_capabilities (position_id, capability)
select x.id, cap.value
  from carres_titles t join public.positions x on x.slug = t.slug
  cross join lateral jsonb_array_elements_text(t.capabilities) as cap(value)
on conflict (position_id, capability) do nothing;

-- 4 . Members
create temporary table carres_members on commit drop as
select m.email, m.name, m.department, m.title, m.disabled,
       (select d.id from public.departments d where d.name = m.department order by d.id limit 1) as department_id,
       (select p.id from public.positions p where lower(p.name) = lower(m.title) order by p.id limit 1) as position_id,
       (case m.department
          -- Management starts on the full-access role, the one sso.ts gives the owner.
          when 'Management' then (select r.id from public.roles r where r.permissions like '%"*"%' order by r.id limit 1)
          else (select r.id from public.roles r where r.name = case m.department
                  when 'Operation' then 'Ops Exec' when 'Warehouse' then 'Storekeeper' else 'BD Exec' end
                order by r.id limit 1)
        end) as named_role_id
  from (values
    ('weisiang329@gmail.com',   'Lim Wei Siang',   'Management',           'Owner',                    false),
    ('jess@carres.com',         'Jess',            'Management',           'COO',                      false),
    ('yujun@carres.com',        'Yu Jun',          'Operation',            'Administration Assistant', false),
    ('shasha@carres.com',       'Shasha',          'Operation',            null,                       false),
    ('khoryee@carres.com',      'Khor Yee',        'Operation',            'Administration Assistant', true),
    ('samantha@carres.com',     'Samantha',        'Operation',            null,                       true),
    ('ccl5117@gmail.com',       'Chan Chee Liang', 'Warehouse',            null,                       false),
    ('hugo@carresofficial.com', 'Herng',           'Business Development', 'Business Development',     false)
  ) as m(email, name, department, title, disabled);

do $members$
declare missing text;
begin
  select string_agg(email, ', ') into missing from carres_members
   where department_id is null or named_role_id is null or (title is not null and position_id is null);
  if missing is not null then
    raise exception 'Carres team: department, title or role not found for %; nothing was changed', missing;
  end if;
end $members$;

insert into public.users (email, name, role_id, status, department_id, position_id)
select m.email, m.name, m.named_role_id, case when m.disabled then 'disabled' else 'active' end, m.department_id, m.position_id
  from carres_members m
 where not exists (select 1 from public.users u where lower(u.email) = m.email);

update public.users u set
       name = case when u.name is null or btrim(u.name) = '' or lower(u.name) = lower(u.email) then m.name else u.name end,
       department_id = m.department_id,
       position_id = coalesce(m.position_id, u.position_id),
       role_id = case when u.role_id in (select r.id from public.roles r where r.name = 'New member') then m.named_role_id else u.role_id end,
       status = case when m.disabled then 'disabled' else u.status end
  from carres_members m
 where lower(u.email) = m.email
   and (u.department_id is distinct from m.department_id
     or u.position_id is distinct from coalesce(m.position_id, u.position_id)
     or u.name is null or btrim(u.name) = '' or lower(u.name) = lower(u.email)
     or u.role_id in (select r.id from public.roles r where r.name = 'New member')
     or (m.disabled and u.status <> 'disabled'));

insert into public.user_departments (user_id, department_id)
select u.id, m.department_id from carres_members m join public.users u on lower(u.email) = m.email
on conflict (user_id, department_id) do nothing;
insert into public.user_companies (user_id, company_id)
select u.id, (select c.id from public.companies c where c.code = 'HOUZS')
  from carres_members m join public.users u on lower(u.email) = m.email
on conflict (user_id, company_id) do nothing;

-- 5 . Kelana Jaya Showroom (an existing KJ-SR row, e.g. with the street the owner filled in, is left as it is)
insert into scm.warehouses (company_id, code, "name", "type", "is_showroom", "is_default", "venue_name", "location", "city", "postcode", "state", "country", "is_active")
values ((select id from public.companies where code = 'HOUZS'), 'KJ-SR', 'Kelana Jaya Showroom', 'showroom', true, false,
        'Kelana Jaya Showroom', null, null, null, 'Selangor', 'Malaysia', true)
on conflict (company_id, code) do nothing;
