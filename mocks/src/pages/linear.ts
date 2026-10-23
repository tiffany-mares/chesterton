import type { LinearTicket } from "../types.js";
import { escapeHtml, htmlDocument } from "./layout.js";

const STYLE = `
  body { font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif; background: #fbfbfb; color: #1a1a1a; margin: 0; padding: 32px; }
  .card { max-width: 720px; margin: 0 auto; background: #fff; border: 1px solid #e3e3e3; border-radius: 8px; padding: 24px; }
  .key { color: #7a7a7a; font-size: 13px; font-weight: 600; letter-spacing: 0.02em; }
  h1 { font-size: 20px; margin: 4px 0 12px; }
  .status { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; background: #e0f2e9; color: #1a7f4e; margin-bottom: 16px; }
  .description { font-size: 14px; line-height: 1.5; color: #3a3a3a; }
`;

export function renderLinearPage(ticket: LinearTicket): string {
  const body = `
<div class="card">
  <div class="key">${escapeHtml(ticket.key)}</div>
  <h1>${escapeHtml(ticket.title)}</h1>
  <div class="status">${escapeHtml(ticket.status)}</div>
  <div class="description">${escapeHtml(ticket.description)}</div>
</div>
`;
  return htmlDocument(`${ticket.key}: ${ticket.title}`, STYLE, body);
}
