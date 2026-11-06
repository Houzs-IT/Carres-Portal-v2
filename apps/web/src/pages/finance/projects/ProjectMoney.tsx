import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PROJECT_COST_CATEGORIES, PROJECT_INCOME_CATEGORIES, projectCategoryLabel,
  type CostRate, type MoneyLine, type PctRow, type PnlColumn, type ProjectPnl,
} from "@carres/shared/project-money";
import type { ProjectSalesOrder } from "@carres/shared/projects";
import ListPageShell from "@/components/ListPageShell";
import { DataGrid, type DataGridColumn } from "@/components/register/DataGrid";
import Button from "@/components/kit/Button";
import DatePicker from "@/components/kit/DatePicker";
import Drawer from "@/components/kit/Drawer";
import Input from "@/components/kit/Input";
import Panel from "@/components/kit/Panel";
import Select from "@/components/kit/Select";
import { apiFetch } from "@/lib/api";
import { fmtDate } from "@/lib/fmt-date";
import { rm } from "@/lib/format-currency";

/**
 * /finance/project-money — a project's money (0754). Weisiang's decision
 * (Mr Lim, 2026-10-22) and YH (3 Nov 2026, "all follow houzs"); Jess was not
 * part of this decision. Follows Houzs frontend/src/pages/projects (the event
 * page's finance section: books lines, typed lines, Total Sales, the two P&Ls)
 * and the project cost rates page. Finance and the principal only.
 */

/** Every word on the page (docs/COPY-STANDARD.md, Project money (slice 5)). */
export const PM = {
  title: "Project money",
  failed: "Project money could not be loaded. Try again.",
  saveFailed: "That did not save. Try again.",
  noProjects: "No project yet.",
  code: "Code", name: "Project", brand: "Brand", start: "Start", end: "End",
  sales: "Sales", totalCost: "Total cost", netProfit: "Net profit",
  rateCards: "Rate cards",
  bySales: "By Total Sales", bySo: "By Sales Orders",
  salesFrom: { lines: "from sales lines", box: "from Total Sales", so: "from Sales Orders", none: "none yet" } as Record<PnlColumn["salesFrom"], string>,
  cogs: "COGS", rental: "Rental", setup: "Setup", transportSetupDismantle: "Transport setup & dismantle", others: "Others Costing",
  transportFee: "Transport Fee", commission: "Commission", merchandise: "Merchandise",
  grossProfit: "Gross profit",
  pctFrom: (r: PctRow) => r.from === "books" ? "from the books" : r.from === "typed" ? "typed" : r.from === "rate" ? `${r.pct}% of sales` : "",
  boost: "boost rate",
  totalSales: "Total Sales", saveTotal: "Save Total Sales",
  lines: "Money lines", noLines: "No money line yet.",
  fromBooks: "From the books", replaced: "Replaced by the books",
  kind: "Kind", cost: "Cost", income: "Income", category: "Category", description: "What it is for", amount: "Amount", date: "Date",
  addLine: "Add line", archive: "Archive",
  salesOrders: "Sales Orders", noSalesOrders: "No Sales Order at this project.", cancelled: "Cancelled",
  rate: { brand: "Brand", transport: "Transport %", merchandise: "Merchandise %", normal: "Commission %", boost: "Boost commission %", minGp: "Boost from GP %", minSales: "Boost from sales", save: "Save rate card", none: "No rate card yet.", edit: "Edit" },
  close: "Close",
};

interface ListRow { id: string; code: string; name: string; brand: string | null; startDate: string; endDate: string; sales: number; totalCost: number; netProfit: number }
interface OneProject {
  project: { id: string; code: string; name: string; brand: string | null; totalSales: number | null; rate: CostRate | null };
  pnl: ProjectPnl; lines: MoneyLine[]; replaced: MoneyLine[]; orders: ProjectSalesOrder[];
}
type RateRow = CostRate & { brand: string };

const KEY = ["finance", "project-money"] as const;
function useWrite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, method, body }: { path: string; method: "POST" | "PUT" | "DELETE"; body?: unknown }) =>
      apiFetch(`/api/finance/projects${path}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
const refusal = (e: unknown) => (e as { body?: { message?: string } } | null)?.body?.message ?? PM.saveFailed;

export default function ProjectMoney() {
  const [params, setParams] = useSearchParams();
  const open = params.get("id");
  const [rates, setRates] = useState(false);
  const q = useQuery({ queryKey: [...KEY, "list"], queryFn: () => apiFetch<{ rows: ListRow[] }>("/api/finance/projects") });
  const columns: DataGridColumn<ListRow>[] = [
    { key: "start", label: PM.start, width: 110, accessor: (r) => fmtDate(r.startDate), dateValue: (r) => r.startDate, filterType: "date" },
    { key: "end", label: PM.end, width: 110, accessor: (r) => fmtDate(r.endDate), dateValue: (r) => r.endDate, filterType: "date" },
    { key: "name", label: PM.name, width: 300, accessor: (r) => r.name },
    { key: "brand", label: PM.brand, width: 120, accessor: (r) => r.brand ?? "", filterType: "enum" },
    { key: "sales", label: PM.sales, width: 130, accessor: (r) => rm(r.sales), exportValue: (r) => r.sales },
    { key: "cost", label: PM.totalCost, width: 130, accessor: (r) => rm(r.totalCost), exportValue: (r) => r.totalCost },
    { key: "net", label: PM.netProfit, width: 130, accessor: (r) => rm(r.netProfit), exportValue: (r) => r.netProfit },
    { key: "code", label: PM.code, width: 260, accessor: (r) => r.code, defaultHidden: true },
  ];
  return (
    <ListPageShell register>
      <DataGrid rows={q.data?.rows ?? []} columns={columns} rowKey={(r) => r.id} storageKey="carres.finance.project-money.v1"
        appearance="reference" exportName={PM.title} groupBanner={false} isLoading={!q.isSuccess && !q.isError}
        emptyMessage={q.isError ? PM.failed : PM.noProjects}
        toolbarStart={<Button size="sm" onClick={() => setRates(true)}>{PM.rateCards}</Button>}
        onRowClick={(r) => setParams({ id: r.id })} />
      {open ? <ProjectMoneyDrawer id={open} onClose={() => setParams({})} /> : null}
      {rates ? <RateCards onClose={() => setRates(false)} /> : null}
    </ListPageShell>
  );
}

function ProjectMoneyDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({ queryKey: [...KEY, "one", id], queryFn: () => apiFetch<OneProject>(`/api/finance/projects/${id}`) });
  const d = q.data;
  return (
    <Drawer open onOpenChange={(o) => { if (!o) onClose(); }} title={d?.project.name ?? PM.title} description={d?.project.code}
      footer={<Button onClick={onClose}>{PM.close}</Button>}>
      {q.isError ? <p className="text-body">{PM.failed}</p> : !d ? null : (
        <div className="flex flex-col gap-3" data-testid="project-money">
          <TotalSales id={id} value={d.project.totalSales} />
          <Panel title={PM.bySales}><PnlRows c={d.pnl.bySales} /></Panel>
          {d.pnl.bySo ? <Panel title={PM.bySo}><PnlRows c={d.pnl.bySo} /></Panel> : null}
          <Lines id={id} lines={d.lines} replaced={d.replaced} />
          <Panel title={PM.salesOrders}>
            {d.orders.length ? (
              <ul className="flex flex-col gap-1 text-body">
                {d.orders.map((o) => (
                  <li key={o.id} className={`flex gap-2 ${o.status === "cancelled" ? "text-c-secondary" : ""}`}>
                    <span className="w-28 shrink-0">{o.so}</span>
                    <span className="min-w-0 flex-1 break-words">{o.customerName ?? ""}{o.status === "cancelled" ? ` · ${PM.cancelled}` : ""}</span>
                    <span className="tabular-nums">{o.total == null ? "" : rm(o.total)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-body text-c-secondary">{PM.noSalesOrders}</p>}
          </Panel>
        </div>
      )}
    </Drawer>
  );
}

/** Houzs eventPnl: one column, row by row. */
function PnlRows({ c }: { c: PnlColumn }) {
  const row = (label: string, amount: number, note = "", strong = false) => (
    <div key={label} className={`flex gap-2 text-body ${strong ? "font-semibold" : ""}`}>
      <span className="min-w-0 flex-1">{label}{note ? <span className="text-c-secondary"> · {note}</span> : null}</span>
      <span className="tabular-nums">{rm(amount)}</span>
    </div>
  );
  return (
    <div className="flex flex-col gap-1">
      {row(PM.sales, c.sales, PM.salesFrom[c.salesFrom], true)}
      {row(PM.cogs, c.cogs.total)}
      {row(PM.grossProfit, c.grossProfit, "", true)}
      {row(PM.rental, c.rental)}
      {row(PM.setup, c.setup)}
      {row(PM.transportSetupDismantle, c.transportSetupDismantle)}
      {row(PM.transportFee, c.transportFee.amount, PM.pctFrom(c.transportFee))}
      {row(PM.commission, c.commission.amount, [PM.pctFrom(c.commission), c.commission.boost ? PM.boost : ""].filter(Boolean).join(" · "))}
      {row(PM.merchandise, c.merchandise.amount, PM.pctFrom(c.merchandise))}
      {row(PM.others, c.others)}
      {row(PM.totalCost, c.totalCost, "", true)}
      {row(PM.netProfit, c.netProfit, "", true)}
    </div>
  );
}

function TotalSales({ id, value }: { id: string; value: number | null }) {
  const [v, setV] = useState(value == null ? "" : String(value));
  const [msg, setMsg] = useState<string | null>(null);
  const w = useWrite();
  const n = v.trim() === "" ? null : Number(v);
  return (
    <span className="flex flex-wrap items-end gap-2">
      <Input id="project-total-sales" label={PM.totalSales} inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)}
        error={msg ?? undefined} />
      <Button size="sm" variant="primary" loading={w.isPending} disabled={n !== null && !(n >= 0)}
        onClick={() => { setMsg(null); w.mutate({ path: `/${id}/total-sales`, method: "PUT", body: { totalSales: n } }, { onError: (e) => setMsg(refusal(e)) }); }}>
        {PM.saveTotal}
      </Button>
    </span>
  );
}

function Lines({ id, lines, replaced }: { id: string; lines: MoneyLine[]; replaced: MoneyLine[] }) {
  const w = useWrite();
  const [kind, setKind] = useState<"cost" | "income">("cost");
  const [category, setCategory] = useState<string>("rental");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const cats = kind === "cost" ? PROJECT_COST_CATEGORIES : PROJECT_INCOME_CATEGORIES;
  const amt = Number(amount);
  const ready = description.trim() !== "" && amount.trim() !== "" && Number.isFinite(amt);
  const add = () => {
    setMsg(null);
    w.mutate({ path: `/${id}/lines`, method: "POST", body: { kind, category, description: description.trim(), amount: amt, occurredAt: date } }, {
      onSuccess: () => { setDescription(""); setAmount(""); },
      onError: (e) => setMsg(refusal(e)),
    });
  };
  const line = (l: MoneyLine, struck: boolean) => (
    <li key={`${struck ? "r" : "l"}-${l.id}`} className={`flex flex-wrap items-center gap-2 ${struck ? "text-c-secondary line-through" : ""}`}>
      <span className="w-40 shrink-0">{projectCategoryLabel(l.category)}</span>
      <span className="min-w-0 flex-1 break-words">
        {l.description}{l.source === "books" ? <span className="text-c-secondary"> · {PM.fromBooks} {l.docNo}</span> : null}
        {struck ? <span> · {PM.replaced}</span> : null}
      </span>
      <span className="tabular-nums">{rm(l.kind === "income" ? l.amount : -l.amount)}</span>
      {!l.source && !struck ? <Button size="sm" loading={w.isPending} onClick={() => w.mutate({ path: `/lines/${l.id}`, method: "DELETE" })}>{PM.archive}</Button> : null}
    </li>
  );
  return (
    <Panel title={PM.lines}>
      <div className="flex flex-col gap-3">
        {lines.length || replaced.length
          ? <ul className="flex flex-col gap-1 text-body">{lines.map((l) => line(l, false))}{replaced.map((l) => line(l, true))}</ul>
          : <p className="text-body text-c-secondary">{PM.noLines}</p>}
        <span className="flex flex-wrap items-end gap-2">
          <Select id="project-line-kind" label={PM.kind} value={kind}
            onValueChange={(v) => { const k = v === "income" ? "income" : "cost"; setKind(k); setCategory(k === "cost" ? "rental" : "sales"); }}
            options={[{ value: "cost", label: PM.cost }, { value: "income", label: PM.income }]} />
          <Select id="project-line-category" label={PM.category} value={category} onValueChange={setCategory}
            options={cats.map((c) => ({ value: c, label: projectCategoryLabel(c) }))} />
          <Input id="project-line-description" label={PM.description} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />
          <Input id="project-line-amount" label={PM.amount} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} error={msg ?? undefined} />
          <DatePicker id="project-line-date" label={PM.date} value={date} onChange={setDate} />
          <Button size="sm" variant="primary" disabled={!ready} loading={w.isPending} onClick={add}>{PM.addLine}</Button>
        </span>
      </div>
    </Panel>
  );
}

/** Houzs project_cost_rates: one card per brand. */
function RateCards({ onClose }: { onClose: () => void }) {
  const q = useQuery({ queryKey: [...KEY, "rates"], queryFn: () => apiFetch<{ rows: RateRow[] }>("/api/finance/projects/rates") });
  const w = useWrite();
  const blank = { brand: "", transportPct: "", merchandisePct: "", commissionNormalPct: "", commissionBoostPct: "", boostMinGpPct: "", boostMinSales: "" };
  const [d, setD] = useState(blank);
  const [msg, setMsg] = useState<string | null>(null);
  const toText = (r: RateRow) => ({
    brand: r.brand, transportPct: String(r.transportPct), merchandisePct: String(r.merchandisePct), commissionNormalPct: String(r.commissionNormalPct),
    commissionBoostPct: r.commissionBoostPct == null ? "" : String(r.commissionBoostPct), boostMinGpPct: r.boostMinGpPct == null ? "" : String(r.boostMinGpPct),
    boostMinSales: r.boostMinSales == null ? "" : String(r.boostMinSales),
  });
  const n = (s: string) => (s.trim() === "" ? null : Number(s));
  const field = (k: keyof typeof blank, label: string) => (
    <Input id={`rate-${k}`} label={label} inputMode={k === "brand" ? undefined : "decimal"} value={d[k]} onChange={(e) => setD((x) => ({ ...x, [k]: e.target.value }))} />
  );
  const save = () => {
    setMsg(null);
    w.mutate({ path: "/rates", method: "PUT", body: {
      brand: d.brand.trim(), transportPct: n(d.transportPct) ?? 0, merchandisePct: n(d.merchandisePct) ?? 0, commissionNormalPct: n(d.commissionNormalPct) ?? 0,
      commissionBoostPct: n(d.commissionBoostPct), boostMinGpPct: n(d.boostMinGpPct), boostMinSales: n(d.boostMinSales),
    } }, { onSuccess: () => setD(blank), onError: (e) => setMsg(refusal(e)) });
  };
  return (
    <Drawer open onOpenChange={(o) => { if (!o) onClose(); }} title={PM.rateCards} footer={<Button onClick={onClose}>{PM.close}</Button>}>
      <div className="flex flex-col gap-3" data-testid="project-rate-cards">
        {q.isError ? <p className="text-body">{PM.failed}</p> : q.data?.rows.length ? (
          <ul className="flex flex-col gap-1 text-body">
            {q.data.rows.map((r) => (
              <li key={r.brand} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1">{r.brand} · {r.transportPct}% · {r.merchandisePct}% · {r.commissionNormalPct}%{r.commissionBoostPct != null ? ` · ${r.commissionBoostPct}%` : ""}</span>
                <Button size="sm" onClick={() => setD(toText(r))}>{PM.rate.edit}</Button>
              </li>
            ))}
          </ul>
        ) : <p className="text-body text-c-secondary">{PM.rate.none}</p>}
        {field("brand", PM.rate.brand)}
        {field("transportPct", PM.rate.transport)}
        {field("merchandisePct", PM.rate.merchandise)}
        {field("commissionNormalPct", PM.rate.normal)}
        {field("commissionBoostPct", PM.rate.boost)}
        {field("boostMinGpPct", PM.rate.minGp)}
        {field("boostMinSales", PM.rate.minSales)}
        {msg ? <p className="text-body">{msg}</p> : null}
        <Button variant="primary" disabled={!d.brand.trim()} loading={w.isPending} onClick={save}>{PM.rate.save}</Button>
      </div>
    </Drawer>
  );
}
