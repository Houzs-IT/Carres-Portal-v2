// Carres only (not part of Houzs's code): an empty cell on the Sales Orders list stays blank (owner, 23 Nov 2026;
// Constitution "no dash anywhere on a screen"). Houzs's columns write their own "—" for an empty value; this wraps a
// column so a cell whose whole content is that dash renders nothing. Exports and filters read getValue/exportValue,
// which this does not touch.
import { isValidElement, type ReactNode } from "react";

const DASHES = new Set(["—", "–", "-"]);

/** Whether a rendered cell is nothing but a dash: the string itself, or one element wrapping only it. */
export function isDashOnly(node: ReactNode): boolean {
  if (typeof node === "string") return DASHES.has(node.trim());
  if (isValidElement(node)) {
    const children = (node.props as { children?: ReactNode }).children;
    return typeof children === "string" && DASHES.has(children.trim());
  }
  return false;
}

export function blankDashes<C extends { render?: (...args: never[]) => ReactNode }>(column: C): C {
  const render = column.render;
  if (!render) return column;
  return { ...column, render: (...args: never[]) => { const out = render(...args); return isDashOnly(out) ? null : out; } };
}
