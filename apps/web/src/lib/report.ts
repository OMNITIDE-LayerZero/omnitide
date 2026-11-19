// PnL report helpers for History: CSV export straight from indexed rows, no server round trip.
import { units6 } from "./format";

type Cell = string | number | boolean;

export function csv(head: string[], rows: Cell[][]): string {
  const cell = (v: Cell) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [head, ...rows].map((r) => r.map(cell).join(",")).join("\n") + "\n";
}

export function download(name: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

export function pnlReport(trades: { realizedPnl: string; fee: string }[], flows: { kind: string; amount: string }[]) {
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const flowsOf = (kinds: string[]) => sum(flows.filter((f) => kinds.includes(f.kind)).map((f) => units6(f.amount)));
  return {
    realized: sum(trades.map((t) => units6(t.realizedPnl))),
    fees: sum(trades.map((t) => units6(t.fee))),
    fills: trades.length,
    deposited: flowsOf(["inflow", "deposit"]),
    withdrawn: flowsOf(["ebb", "withdraw"]),
  };
}
