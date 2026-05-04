/**
 * CSV utilities.
 *
 * `toCSV(rows)` converts an array of plain objects into a UTF-8 CSV string.
 * Header row is taken from the keys of the first row. Values are escaped per
 * RFC 4180 — wrapped in double quotes when they contain a comma, newline,
 * or quote, with embedded quotes doubled.
 *
 * `shareCSV(filename, content)` writes the string to the cache directory
 * and opens the OS share sheet via expo-sharing. On platforms where Sharing
 * isn't available it returns false instead of throwing.
 */
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";

export type CsvRow = Record<string, string | number | boolean | null | undefined>;

export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Convert rows to a CSV string. The header row is the union of keys across
 * `rows` (in first-seen order) so missing values become empty cells rather
 * than throwing.
 */
export function toCSV(rows: ReadonlyArray<CsvRow>): string {
  if (rows.length === 0) return "";

  const headers: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (!seen.has(k)) {
        seen.add(k);
        headers.push(k);
      }
    }
  }

  const lines: string[] = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  }
  return lines.join("\r\n");
}

/**
 * Write `content` to the cache dir and open the native share sheet.
 * Resolves to true if the share sheet was opened, false if Sharing isn't
 * available on the platform.
 */
export async function shareCSV(
  filename: string,
  content: string,
): Promise<boolean> {
  // Sanitize filename — no slashes, no leading dots
  const safe = filename.replace(/[^\w.-]+/g, "_").replace(/^\.+/, "");
  const uri = `${FileSystem.cacheDirectory}${safe}`;

  await FileSystem.writeAsStringAsync(uri, content, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  if (!(await Sharing.isAvailableAsync())) return false;

  await Sharing.shareAsync(uri, {
    mimeType: "text/csv",
    dialogTitle: "Export Pulse data",
    UTI: "public.comma-separated-values-text",
  });
  return true;
}

/** Convenience: timestamped filename like "pulse-categories-2026-05-04.csv". */
export function timestampedFilename(prefix: string): string {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `${prefix}-${stamp}.csv`;
}
