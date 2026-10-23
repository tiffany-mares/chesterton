import type { SlackThread } from "../types.js";
import { escapeHtml, htmlDocument } from "./layout.js";

const STYLE = `
  body { margin: 0; display: flex; font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif; background: #1a1d21; color: #d1d2d3; }
  .sidebar { width: 220px; background: #19171d; padding: 16px 12px; color: #a9a6ab; min-height: 100vh; }
  .sidebar .workspace { color: #fff; font-weight: 700; margin-bottom: 16px; }
  .sidebar .channel { padding: 4px 8px; border-radius: 4px; }
  .sidebar .channel.active { background: #1164a3; color: #fff; }
  .main { flex: 1; background: #1a1d21; }
  .thread-header { padding: 16px 20px; border-bottom: 1px solid #2c2d30; font-weight: 700; color: #fff; }
  .messages { padding: 12px 20px; }
  .message { display: flex; gap: 10px; padding: 8px 0; }
  .avatar { width: 36px; height: 36px; border-radius: 6px; background: #4a154b; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0; }
  .msg-body { flex: 1; }
  .msg-meta { font-size: 13px; }
  .msg-meta .user { color: #fff; font-weight: 700; margin-right: 8px; }
  .msg-meta .ts { color: #8a8b8d; font-size: 12px; }
  .msg-text { color: #d1d2d3; font-size: 14px; }
`;

function initials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

function formatTs(ts: string): string {
  const millis = Number(ts) * 1000;
  if (Number.isNaN(millis)) return ts;
  return new Date(millis).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

export function renderSlackPage(channel: string, thread: SlackThread): string {
  const messages = thread.messages
    .map(
      (m) => `<div class="message">
  <div class="avatar">${escapeHtml(initials(m.user))}</div>
  <div class="msg-body">
    <div class="msg-meta"><span class="user">${escapeHtml(m.user)}</span><span class="ts">${escapeHtml(formatTs(m.ts))}</span></div>
    <div class="msg-text">${escapeHtml(m.text)}</div>
  </div>
</div>`
    )
    .join("\n");

  const body = `
<div class="sidebar">
  <div class="workspace">acme</div>
  <div class="channel active"># ${escapeHtml(channel)}</div>
</div>
<div class="main">
  <div class="thread-header">${escapeHtml(thread.title)}</div>
  <div class="messages">
${messages}
  </div>
</div>
`;

  return htmlDocument(thread.title, STYLE, body);
}
