# Service Cases: Carres against Houzs (gap list, 2 Nov 2026)

Source: Houzs ERP `origin/main` at `675aebbcc` (2 Nov 2026). Carres: `origin/main` at `7058c36e5`.
Already ported: #2118 (0711: owner, My Cases, stage by hand, Close Case, stage cards, Service Settings),
#2185 (list columns, summary, funnel, Board/Calendar, case page), #2191 (bulk Assign to me, print copies,
per-field save, Creditor filter, Export All), #2137/#2139/#2154/#2170 (UI fixes).

Yes = Carres has it. Partly = some of it. No = missing. "Built here" names the draft PR from this round.

| # | Houzs feature | Houzs source | Carres | Carres today | Built here |
|---|---|---|---|---|---|
| 1 | List: every column sorts and filters over all matching cases, no pager (b5c647b4a) | `frontend/src/pages/ServiceCases.tsx` | Yes | `GET /service-cases` returns every case, the shared DataGrid sorts and filters in the browser [code: apps/api/src/routes/ops/service-cases.ts:467] | nothing to do |
| 2 | Stage history: when a case entered each stage, who moved it | `backend/src/services/assr.ts:905-1020` (`assr_stage_history`) | No | `status_id` is overwritten, no history row [code: supabase/migrations/0210_service_cases.sql] | PR A |
| 3 | Days in stage / In stage since column ("Priority · Dwell") | `ServiceCases.tsx:773-823`, `assr.ts:1971-2018` | No | #2185 left it out for want of a stage date [code: apps/web/src/pages/operation/OperationServiceCases.tsx:154] | PR A |
| 4 | Target days per stage, snapshotted when the case enters it; Lead Time pill on the case page | `082_assr_priority_stage_targets.sql`, `ServiceCases.tsx:7127-7175` | No | Carres has one 14 working-day clock per case (0298) | PR A (per stage; per priority left out) |
| 5 | Funnel overdue = past the stage's target days | `QualitySummary.tsx:125` | Partly | funnel counts cases past the 14-day deadline [code: OperationServiceCases.tsx:108] | PR A adds "past stage target" |
| 6 | Stage changes on the case Timeline | `assr.ts:2296-2339` (`assr_activity`) | No | #2185 left it out | PR A |
| 7 | Lead Time settings page (target days by priority and stage) | `ServiceLeadTimePortal.tsx` | Partly | Service Settings edits stage names only [code: apps/web/src/pages/operation/ServiceSettings.tsx] | PR A: target days per stage in Service Settings |
| 8 | Pickup / Return: pickup status, scheduled pickup date (ETA), actual pickup date, pickup PIC, item location (4d440ca97) | `backend/src/scm/shared/assr-pickup-tracking.ts`, `frontend/src/components/assr/PickupTrackingFields.tsx` | No | no pickup fields on `service_cases` | PR B |
| 9 | Pickup by / Delivery by (Own team or Supplier), requested date per leg | `ServiceCaseDeliveryBy.tsx`, `0268_assr_pickup_by.sql`, `159_assr_delivery_by.sql` | No | none | PR B |
| 10 | The case date is a request; Logistics confirms it on Delivery Planning, the case shows "Logistics confirmed" (002deb115) | `backend/src/lib/delivery-sheet-assr-feed.ts`, `LogisticsConfirmedNote` | No | Carres Delivery Planning (0723) reads orders only [code: apps/api/src/routes/operation/delivery-planning.ts:38] | PR B stores requested and confirmed dates on the case and shows both. The Delivery Planning board side is NOT built (see Left out) |
| 11 | WhatsApp Service Arrangement with Confirm / Amend, answers on the case timeline (45a7d6834) | `backend/src/scm/lib/assr-arrangement-message.ts`, `routes/chatCallback.ts` | No | Carres has no WhatsApp template send or chat callback [code: grep of apps/api/src for "chat-callback" and "wa_message" finds nothing] | Left out |
| 12 | Sub-status inside a stage (customer pickup / supplier pickup / supplier return) | `backend/src/scm/shared/assr-sub-statuses.ts` | No | Carres stages are config rows, not a fixed list | Left out |
| 13 | Void Case (terminal "Not valid") | `assr-stage-labels.ts` `voided` | Partly | a closing stage can be added in Service Settings | nothing to do |
| 14 | Quality page: time in each stage, overdue cases by stage, monthly trend, supplier return rate | `QualitySummary.tsx`, `routes/assrQuality.ts` | Partly | Quality Overview has counts and reasons [code: apps/web/src/pages/operation/components/ServiceCaseNumbersPanel.tsx] | Left out; needs PR A merged first (stage history feeds it) |
| 15 | Service Metrics (issue category donut, resolution method mix, NCR) | `ServiceMetrics.tsx` | Partly | Quality Overview; no resolution method field | Left out |
| 16 | My Cases page with conversation and "ping ops" | `MyCases.tsx` | Partly | My cases tick on the list [code: OperationServiceCases.tsx:47] | nothing to do (Carres has no salesperson portal for it) |
| 17 | Lookup lists: issue categories, resolution methods, priorities, product categories, root cause | `ServiceSettings.tsx:90-111`, `065_assr_lookups.sql` | Partly | issue, product category and priority are fixed lists in shared code | Left out (#2118 left it out too) |
| 18 | Archived filter and bulk archive | `ServiceCases.tsx` | No | none | Left out |
| 19 | Customer satisfaction on close | `015_assr_surveys.sql` | No | none | Left out |
| 20 | Case access grants, portal links | `routes/assrAccess.ts`, `routes/assrPortal.ts` | No | #2191 left out: needs a table and a public page review | Left out |
| 21 | Cost tracking per case | `037_assr_settings_and_costs.sql` | Partly | `incurred_charges` text | Left out |

## Left out this round, and why

- **Delivery Planning board for service legs (row 10).** The board is order-based in Carres and the Supply Chain session is working on Delivery Planning at the same time. PR B keeps the requested date and the Logistics confirmed date on the case so the board can read them later.
- **WhatsApp Confirm / Amend (row 11).** Needs a WhatsApp sender and callback that Carres does not have.
- **Target days per priority (row 4, 7).** Carres priority is three fixed values; one target per stage is the Houzs fallback (the Lead Time profile) and is enough to show dwell and overdue.
- **Quality page additions (row 14).** Waits for PR A's stage history to collect real data.
- Rows 12, 15, 17-21: each needs its own business answer or table; none is asked for in this round.
