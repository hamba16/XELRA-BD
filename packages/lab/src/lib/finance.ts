import type { Line } from "./recon.ts";

/** Bounded RFC 4180 parser. Quotes and embedded newlines are retained correctly. */
export function parseCsv(source: string, maxRows = 1000): string[][] {
  if (source.length > 2_000_000) throw Error("CSV files must be at most 2 MB.");
  const input = source.replace(/^\uFEFF/, "");
  const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false, closed = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else cell += c;
    } else if (c === '"') {
      if (cell || closed) throw Error("Unexpected quote in CSV.");
      quoted = true;
    } else if (c === ",") { row.push(cell); cell = ""; closed = false; }
    else if (c === "\r" || c === "\n") {
      if (c === "\r" && input[i + 1] === "\n") i++;
      row.push(cell); if (row.some(v => v !== "")) rows.push(row);
      if (rows.length > maxRows) throw Error(`CSV files are limited to ${maxRows} rows.`);
      row = []; cell = ""; closed = false;
    } else { if (closed) throw Error("Unexpected characters after a quoted CSV field."); cell += c; }
  }
  if (quoted) throw Error("An open quote was not closed in the CSV file.");
  row.push(cell); if (row.some(v => v !== "")) rows.push(row);
  if (rows.length > maxRows) throw Error(`CSV files are limited to ${maxRows} rows.`);
  if (rows.some(r => r.length !== rows[0].length)) throw Error("CSV rows must contain the same number of columns.");
  return rows;
}
export function csvExport(headers: string[], rows: (string | number | null)[][]): string {
  const cell = (value: string | number | null) => {
    let s = value == null ? "" : String(value);
    // A quoted cell can still execute as a spreadsheet formula. Escape text only.
    if (typeof value === "string" && /^[\s]*[=+@\-\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  return [headers, ...rows].map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
export interface StatementMapping { reference: string; date: string; amount: string; description: string }
export function statementCsv(source: string, mapping: StatementMapping): { lines: Line[]; duplicates: number } {
  const [headers, ...rows] = parseCsv(source, 501);
  if (!headers || new Set(headers).size !== headers.length) throw Error("A unique header row is required.");
  const columns = [mapping.reference, mapping.date, mapping.amount, mapping.description].map(name => headers.indexOf(name));
  if (columns.some(i => i < 0) || new Set(columns).size !== 4) throw Error("Map four distinct columns: reference, date, signed amount and description.");
  const lines: Line[] = [], seen = new Map<string, string>(); let duplicates = 0;
  for (const row of rows) {
    const [id, date, amountText, description] = columns.map(i => row[i].trim());
    if (!id || id.length > 200 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw Error("Each statement line needs a reference and a valid YYYY-MM-DD date.");
    if (!/^-?\d+$/.test(amountText)) throw Error("Amounts must be signed whole UGX values, without separators.");
    const amount = Number(amountText);
    if (!Number.isSafeInteger(amount) || Math.abs(amount) > 9_000_000_000_000 || !description || description.length > 1000) throw Error("Invalid statement amount or description.");
    const canonical = JSON.stringify([date, amount, description]);
    if (seen.has(id)) { if (seen.get(id) !== canonical) throw Error("A transaction reference has conflicting content."); duplicates++; continue; }
    seen.set(id, canonical); lines.push({ id, date, amount, text: description });
  }
  return { lines, duplicates };
}
/** Human-reviewed split candidates only; never posts or silently accepts a group. */
export function groupMatches(target: Line, candidates: Line[]): string[][] {
  if (candidates.length > 6) throw Error("Choose at most six candidates for a split match.");
  if (new Set(candidates.map(c => c.id)).size !== candidates.length) throw Error("Candidate references must be unique.");
  const valid = (line: Line) => Number.isSafeInteger(line.amount) && /^\d{4}-\d{2}-\d{2}$/.test(line.date) && Number.isFinite(Date.parse(line.date)) && new Date(line.date).toISOString().slice(0, 10) === line.date;
  if (![target, ...candidates].every(valid)) throw Error("Matching requires valid dates and whole amounts.");
  const eligible = candidates.filter(c => Math.sign(c.amount) === Math.sign(target.amount) && Math.abs(Date.parse(c.date) - Date.parse(target.date)) <= 7 * 86400000);
  const groups: string[][] = [];
  for (let mask = 1; mask < 2 ** eligible.length; mask++) {
    const selected = eligible.filter((_, i) => mask & (1 << i));
    if (selected.length > 1 && selected.reduce((sum, c) => sum + c.amount, 0) === target.amount) groups.push(selected.map(c => c.id));
  }
  return groups;
}
export interface CashFlow { due: string; amount: number; source: string }
export function forecast13Weeks(balance: number | null, asOf: string, flows: CashFlow[]) {
  if (balance === null) return null;
  if (!Number.isSafeInteger(balance) || !Number.isFinite(Date.parse(asOf))) throw Error("A dated, whole-UGX opening balance is required.");
  let closing = balance;
  return Array.from({ length: 13 }, (_, i) => {
    const start = Date.parse(asOf) + i * 7 * 86400000, end = start + 7 * 86400000;
    const amount = flows.filter(f => Date.parse(f.due) >= start && Date.parse(f.due) < end).reduce((sum, f) => {
      if (!Number.isSafeInteger(f.amount) || !f.source) throw Error("Forecast flows need exact amounts and source references.");
      return sum + f.amount;
    }, 0);
    closing += amount;
    if (!Number.isSafeInteger(closing)) throw Error("Forecast total is outside the supported range.");
    return { week: i + 1, starts: new Date(start).toISOString().slice(0, 10), movement: amount, closing };
  });
}
