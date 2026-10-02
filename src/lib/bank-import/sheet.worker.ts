/// <reference lib="webworker" />
/**
 * Reads a spreadsheet in its own worker, away from the app page. The file's bytes only ever
 * live in this worker's memory; the page gets back plain text cells and then ends the worker,
 * which throws everything else away. (Belt and braces: a bad file can't touch the app itself.)
 */
import * as XLSX from "xlsx";

self.onmessage = (event: MessageEvent<ArrayBuffer>) => {
  try {
    const workbook = XLSX.read(new Uint8Array(event.data), { type: "array", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "", dateNF: "dd/mm/yyyy" });
    const grid = rows.slice(0, 5000).map((row) => (Array.isArray(row) ? row : []).slice(0, 60).map((cell) => String(cell ?? "")));
    (self as unknown as Worker).postMessage({ ok: true, grid });
  } catch {
    (self as unknown as Worker).postMessage({ ok: false });
  }
};
