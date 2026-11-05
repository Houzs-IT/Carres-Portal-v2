# Projects port plan (fairs and exhibitions, Houzs way)

Weisiang's decision (Mr Lim, 22 Oct 2026, via YH): clear Carres rules, implement Houzs. YH chose
"start all three" (Service Cases, Projects, Supply Chain) on 2 Nov 2026. Jess was not part of that
ruling. This file is the build plan for the port; it is not module law and it does not replace any
MASTER.

Source: Houzs ERP `origin/main` (read 2 Nov 2026). Houzs Projects = fairs, exhibitions and solo
roadshows (`docs/modules/projects-pms.md:1-6`). Conts's renovation Projects (board, monitor, rooms)
is out.

## 1. What Houzs Projects does

One row per event. A project has a code, a name, dates, a venue, an organizer, a brand, an event type
(Exhibition / Solo), a booth contractor, a booth number and size, a person in charge (PIC), a
`stage` and a `status` [code: backend/src/db/schema.pg.ts:154-192].

- `stage` = draft → setup → live → dismantle → completed, the internal workflow
  [code: backend/src/db/migrations/053_simplify_project_stages.sql:3-14].
- `status` = pending / confirmed / cancelled, the boss-facing state and the calendar colour
  [code: backend/src/db/migrations/088_project_status.sql:3-16].
- Archive hides a project; only the status control is withheld on an archived project
  [code: docs/modules/projects-pms.md:12-14].
- Code = `YYYY-MM-{ORGANIZER}-{STATE}-{VENUE}-{BRAND}`, `SOLO` for a solo event, `-2`, `-3` on a
  clash [code: backend/src/services/project-naming.ts:25-60].

### Screens and flow (Houzs sidebar `frontend/src/components/Sidebar.tsx:367-404`)

| Houzs screen | What it shows | Flow |
|---|---|---|
| Project Overview (`view=finances`) | P&L by event, profitability drill | finance viewers only |
| Project List (`view=list`) | Cards / Table / Reminder toggle; filters search, brand, status, date range, section, pending task, phase | row opens the detail page [code: frontend/src/pages/Projects.tsx:571-640] |
| Calendar (`view=calendar`) | month grid, bars tinted by status | bar opens the detail page [code: frontend/src/pages/projects/ProjectsCalendarView.tsx] |
| Project detail | spec strip, stage stepper, tasklist sections, team, sales attending, logistics crew, Sales Orders block, sales bills, finance ledger, P&L, stock transfers, activity/chat | [code: frontend/src/pages/Projects.tsx:1830-3034, 160-283] |
| Create project panel | brand, event type, venue, organizer, dates, PIC; picks a checklist template | [code: frontend/src/pages/projects/CreateProjectPanel.tsx] |
| Project Maintenance | brands, event types, venues, organizers, contractors, checklist templates, cost rates | [code: frontend/src/pages/ProjectMaintenance.tsx] |
| Print | project sheet / reports | [code: backend/src/routes/projects_print.ts] |

Normal journey: Maintenance masters exist → staff create a project (template's tasks are cloned in)
→ status pending → confirmed → stage draft → setup (crew, lorry, stock out) → live (sales written at
the fair are linked to the project) → dismantle (stock back) → completed → finance closes the P&L.

## 2. Carres tables (no `company_id`, Carres ids are uuid, money `numeric(12,2)`)

Carres has one company, so Houzs' company scope (`project-company-gate.ts`, `activeCompanySql`) is
dropped [code: docs/modules/projects-pms.md:120-131]. Row security replaces the company gate.

| Carres table | From Houzs | Slice |
|---|---|---|
| `projects` | `projects` minus `company_id`; brand/venue/organizer/contractor kept as text (Houzs stores names, pickers are backed by masters) [code: schema.pg.ts:154-192] | 1 |
| `project_activity` | `project_activity` (stage/status changes, notes) [code: schema.pg.ts:241-251] | 1 |
| `project_masters` (one table, `kind` = brand, venue, organizer or contractor; event types stay the fixed Exhibition and Solo of slice 1) — built as 0751 from `project_brands`, `project_venues`, `project_organizers`, `project_contractors` | Houzs masters [code: schema.pg.ts:206-213; migrations/038_venues.sql; 028_organizers.sql; migrations-pg/20260902T1224_projects_contractor.sql] | 2 |
| `project_team` | `project_team` (user + role) [code: migrations/021_projects.sql project_team] | 2 |
| `project_checklist_templates`, `_template_sections`, `_template_items`, `project_checklist_sections`, `project_checklist`, `project_checklist_comments` | Houzs checklist set [code: schema.pg.ts:541-631; migrations/024_pms_notion_parity.sql] | 3 |
| `orders.project_id` (nullable FK) | `scm.mfg_sales_orders.project_id` [code: migrations-pg/0146_scm_so_project_id.sql] | 4 |
| `project_finance`, `project_finance_lines`, `project_cost_rates` | Houzs finance [code: schema.pg.ts:531-539, 1169-1198] | 5 |
| `project_stock_transfers` | `project_stock_transfers`, plus `warehouse_id` → Carres `warehouses` [code: migrations/026_payment_and_stock.sql] | 6 |

## 3. Routes in `carres-portal-v2-api`

All under `apps/api/src/routes/operation/projects*.ts`, mounted at `/api/operation/projects`. The
caller's own token reaches the tables (`userClient`), the same as `operation/fleet.ts`.

| Slice | Routes |
|---|---|
| 1 | `GET /` (filters: search, status, stage, brand, from, to, archived), `GET /:id`, `POST /`, `PATCH /:id`, `POST /:id/archive`, `POST /:id/unarchive`, `POST /:id/notes` |
| 2 | `GET /masters`, `POST /masters`, `PATCH /masters/:mid` (a master is retired with `active`, never removed); `POST /:id/team`, `DELETE /team/:teamId` |
| 3 | `GET/POST /checklist-templates`, `PATCH /checklist-templates/:tid`, `POST /checklist-templates/:tid/items`, `DELETE /checklist-template-items/:iid`, `POST /:id/checklist`, `POST /:id/checklist/apply`, `POST /checklist/:taskId/status`, `DELETE /checklist/:taskId` (sections are a text label on the task; no templates seeded, Houzs seed titles carry dashes) |
| 4 | `GET /:id/sales-orders` (orders with `project_id`, money from the shared `orderMoney`, which reads `orders.paid`), `POST /:id/sales-orders {so}`, `DELETE /:id/sales-orders/:orderId`, both through `project_link_order` |
| 5 | `PATCH /:id/finance`, `POST /:id/finance/lines`, `PATCH/DELETE /finance/lines/:lineId`, `GET /cost-rates`, `PUT /cost-rates/:brand` |
| 6 | `POST /:id/stock-transfers`, `POST /stock-transfers/:tid/confirm`, `/unconfirm`, `DELETE /stock-transfers/:tid` |
| 7 | none: the sheet is drawn in the browser with the Carres PDF kit (`lib/pdf/project-sheet-template.tsx`) from the reads the project page already holds, so no second read can disagree with the screen |

## 4. Permissions (Houzs → Carres)

Houzs has four axes: page access by position, company scope, a permission matrix, and PMS roles
inside a project [code: docs/modules/projects-pms.md:31-87]. Carres has Supabase Auth roles and
row security. Mapping:

| Houzs | Carres |
|---|---|
| `projects.list`, `projects.read`, `projects.write`, `projects.checklist.tick` | `operation` and `principal` (`requireOperation`, `public.is_operation()`) |
| `projects.manage` (masters, archive) | `operation` and `principal` [my guess: Carres has no finer Projects duty yet] |
| `projects.finance.view` and money on the list | `principal` and `finance` only; stripped server-side for everyone else, the Houzs rule [code: docs/modules/projects-pms.md:115-117] |
| crew scoping (Helper, Storekeeper see only assigned projects) | left out: Carres crew have no portal login [my guess] |
| company switcher | none |

## 5. Slices (each usable on its own, one draft PR each, stacked)

1. **Project list + create + detail.** List (Table view), filters, create form, detail page with spec
   strip, stage stepper, status select, archive, activity notes. Nav: new `Projects` module in the
   Operations menu with `Project List`.
2. **Masters + team.** Project Maintenance page (brands, event types, venues, organizers,
   contractors); the create/edit form picks from them; team on the detail page.
3. **Checklist.** Templates with sections and items (due offset days), cloned at create; tick
   done / N/A / blocked on the detail page; progress %.
4. **Sales Orders at the fair.** `orders.project_id`; detail page lists the linked orders with total,
   paid and balance (from `orders.paid` through `orderMoney`; summing `order_payments` would count a
   deposit twice [code: packages/shared/src/order-money.ts:22-28]), cancelled excluded; link / unlink an order.
5. **Finance (0754).** YH, 3 Nov 2026: "decision all follow houzs, i repeat, all follow houzs".
   Houzs's model: Finance marks an account Needs project and the row it fills; a bill, voucher or
   journal line names its project and its ledger leg carries it; confirm and approve refuse a
   needs-project line with none. The Finance page Project money reads the books live (posted legs,
   neither side of a reversal, plus vouchers checked and not yet approved), lets a row the books fill
   replace its typed lines, and shows the two P&Ls (By Total Sales, By Sales Orders) with brand rate
   cards. Money is visible to Finance and the principal only (gl_may_read).
6. **Stock transfers.** Stock out to the fair / return, by Carres warehouse, confirm / unconfirm.
7. **Print.** Project sheet.
8. **Calendar view.** The Project List offers `List` · `Calendar`; Calendar is the Houzs bar grid, drawn
   by the kit `BarCalendar` admitted for it (bars tinted by status, Houzs state order, click opens the
   project). The slice 8a month rail beside the list is removed: Houzs has none.

## 6. Left out (does not fit Carres, not built)

- POS sales at the fair (`/api/project-pos-sales`): Carres fairs sell through Sales Orders, and
  Houzs POS is its own module [code: backend/src/routes/project-pos-sales.ts].
- Evening sales report parsed from the project chat and `project_sales_bills`: depends on Houzs chat
  and booklet numbers; Houzs itself marks `public.project_sales_bills` unused
  [code: docs/modules/projects-pms.md:213-226].
- Public contractor / brand share links and calendars: outside-party links need owner approval in
  Carres (CLAUDE.md §4 PLAN AUTHORITY BOUNDARY) [my guess that this applies].
- Fair report and setup invoice AI scans (`/fair-report/*`, `/setup-invoice/*`): Houzs agents.
- Defect photo two-stage review, phase photos, region-split reviewers: keyed on Houzs positions
  (Storekeeper Supervisor, Ops Exec) that Carres does not have [code: docs/modules/projects-pms.md:18-27].
- Supplier credit notes knocking off a project's books (Houzs SCN credits in `event-books.ts`): not
  in slice 5; credit and debit note lines carry no project yet.
- Venue resolution onto Sales Orders (`venue_source`) and commission by venue: Carres commission is a
  separate HR rule [my guess].
- Notion URL, project chat, unread markers, CSV import.
- Crew per lorry for setup/dismantle (`setup_crew` JSON): deferred until slice 6 is in use; Carres
  lorries live in `partner_fleet` (0724).
