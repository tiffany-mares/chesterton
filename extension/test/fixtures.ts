// Builds DOM fixtures that mirror the exact structure rendered by
// mocks/src/pages/prFiles.ts (div.file[data-tagsearch-path] > .file-header[data-path] +
// table.diff > tbody > tr > td.blob-num[data-line-number] x2 + td.blob-code).
// Kept in lockstep with that renderer's markup contract (see contracts.md "extension (MV3)").

export interface FixtureLine {
  type: "context" | "add" | "del";
  oldLine: number | null;
  newLine: number | null;
  text: string;
}

function lineMarker(line: FixtureLine): string {
  if (line.type === "add") return "+";
  if (line.type === "del") return "-";
  return " ";
}

function renderRow(line: FixtureLine): string {
  const rowClass =
    line.type === "add" ? "diff-line-add" : line.type === "del" ? "diff-line-del" : "diff-line-context";
  const oldNumClass = line.type === "del" ? "blob-num blob-num-deletion" : "blob-num";
  const newNumClass = line.type === "add" ? "blob-num blob-num-addition" : "blob-num";
  const oldNum = line.oldLine ?? "";
  const newNum = line.newLine ?? "";
  const code = `${lineMarker(line)}${line.text}`;

  return `<tr class="${rowClass}">
<td class="${oldNumClass}" data-line-number="${oldNum}"></td>
<td class="${newNumClass}" data-line-number="${newNum}"></td>
<td class="blob-code">${code}</td>
</tr>`;
}

export function renderFileBlock(filePath: string, lines: FixtureLine[]): string {
  const rows = lines.map(renderRow).join("\n");
  return `<div class="file" data-tagsearch-path="${filePath}">
  <div class="file-header" data-path="${filePath}">${filePath}</div>
  <table class="diff">
    <tbody>
${rows}
    </tbody>
  </table>
</div>`;
}

/** PR#1 style fixture: payments client.py, MAX_RETRIES 3 -> 50 (replace = del + add pair). */
export const PAYMENTS_FILE = "services/payments/client.py";

export const paymentsFileLines: FixtureLine[] = [
  { type: "context", oldLine: 10, newLine: 10, text: "def charge(amount):" },
  { type: "context", oldLine: 11, newLine: 11, text: "    # retry payment up to N times" },
  { type: "del", oldLine: 12, newLine: null, text: "    MAX_RETRIES = 3" },
  { type: "add", oldLine: null, newLine: 12, text: "    MAX_RETRIES = 50" },
  { type: "context", oldLine: 13, newLine: 13, text: "    for attempt in range(MAX_RETRIES):" },
];

export function renderPrPage(blocks: string[]): string {
  return `<div class="pr-header"><h1>acme/storefront #1</h1></div>\n${blocks.join("\n")}`;
}
