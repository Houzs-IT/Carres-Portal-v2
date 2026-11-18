import type { ReactNode } from "react";
import type { Column } from "./dataTableTypes";

/** Pair only adjacent fields with matching pin/width preferences in saved views.
 * Original column objects continue to own all sorting, filters and exports. */
export function pairedColumnGroups<T>(
  columns: Column<T>[],
  pairs: readonly (readonly string[])[],
  compact: boolean,
  widths: Record<string, number>,
  pinned: ReadonlySet<string>,
  pinnedRight: ReadonlySet<string>,
): Column<T>[][] {
  const groups: Column<T>[][] = [];
  for (let index = 0; index < columns.length; index++) {
    const first = columns[index];
    const next = columns.at(index + 1);
    const pair = pairs.find((keys) => keys[0] === first.key && keys[1] === next?.key);
    const samePrefs = next && (pinned.has(first.key) || Boolean(first.alwaysVisible && pinned.has(next.key))) === pinned.has(next.key)
      && pinnedRight.has(first.key) === pinnedRight.has(next.key)
      && widths[first.key] === widths[next.key];
    if (next && (pair || compact && !pairs.some((keys) => keys.includes(first.key))) && samePrefs) {
      groups.push([first, next]);
      index++;
    } else {
      groups.push([first]);
    }
  }
  return groups;
}

export function pairedColumn<T>(fields: Column<T>[], header: (field: Column<T>) => ReactNode): Column<T> {
  const first = fields[0];
  const second = fields.at(1);
  return {
    ...first,
    width: "132px",
    renderHeader: () => <div className="dt-paired-header">{fields.map((field) => <div key={field.key}>{header(field)}</div>)}</div>,
    render: (row) => <div className="dt-paired-value">{fields.map((field) => {
      const raw = field.getValue?.(row);
      return <div key={field.key} data-field-key={field.key} title={typeof raw === "string" ? raw : undefined}>{field.render(row)}</div>;
    })}</div>,
    total: fields.some((field) => field.total)
      ? (rows) => <div className="dt-paired-value">{fields.map((field) => <div key={field.key}>{field.total?.(rows)}</div>)}</div>
      : undefined,
    // The synthetic display has the first key, but every operation uses fields.
    label: second ? `${first.label} / ${second.label}` : first.label,
  };
}
