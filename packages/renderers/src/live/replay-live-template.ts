import type { ReplayReport } from '@tokenleak/core';
import type { ReplayHeatmapEntry } from './replay-live-server';

export interface ReplayLiveHtmlOptions {
  /** Optional heatmap to render above the cost odometer for date navigation. */
  heatmap?: ReplayHeatmapEntry[];
  /** Date to mark as active in the heatmap. Defaults to the report's date. */
  initialDate?: string;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escScript(json: string): string {
  // Prevent the JSON payload from prematurely closing our <script> tag,
  // and protect against U+2028/U+2029 line terminators that JSON allows but JS does not.
  return json
    .replace(/<\//g, '<\\/')
    .replace(new RegExp('\u2028', 'g'), '\\u2028')
    .replace(new RegExp('\u2029', 'g'), '\\u2029');
}

function formatDateLong(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function formatHeatmapDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function formatHeatmapTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M tok`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K tok`;
  return `${Math.round(n)} tok`;
}

function formatHeatmapCost(n: number): string {
  return `$${n.toFixed(2)}`;
}

const HEATMAP_DAYS = 91; // 13 weeks × 7 days

/**
 * Render the GitHub-style heatmap above the cost odometer for in-page date
 * navigation. Each cell is an `<a>` so clicks just navigate to `/?date=X`
 * — no JS required.
 *
 * Layout: 7 rows (Sun-Sat) × ~13 cols (weeks), latest day on the right.
 */
function renderHeatmapSection(entries: ReplayHeatmapEntry[], activeDate: string): string {
  const byDate = new Map<string, ReplayHeatmapEntry>();
  for (const e of entries) byDate.set(e.date, e);

  // Determine the day window: anchor on today (or the latest entry, whichever is later).
  const todayStr = new Date().toISOString().slice(0, 10);
  const latestEntryDate = entries.reduce((acc, e) => (e.date > acc ? e.date : acc), todayStr);
  const end = new Date(latestEntryDate + 'T00:00:00Z');
  const start = new Date(end.getTime() - (HEATMAP_DAYS - 1) * 86_400_000);

  const maxTokens = entries.reduce((acc, e) => Math.max(acc, e.tokens), 0);
  const totalTokens = entries.reduce((acc, e) => acc + e.tokens, 0);
  const totalCost = entries.reduce((acc, e) => acc + e.cost, 0);
  const activeDays = entries.filter((e) => e.tokens > 0).length;

  // Walk forward from start; bucket into weeks (column = week index).
  const cells: Array<{ date: string; tokens: number; cost: number; events: number; weekday: number; col: number }> = [];
  for (let i = 0; i < HEATMAP_DAYS; i++) {
    const d = new Date(start.getTime() + i * 86_400_000);
    const dateStr = d.toISOString().slice(0, 10);
    const weekday = d.getUTCDay(); // 0 = Sun
    const col = Math.floor(i / 7);
    const e = byDate.get(dateStr);
    cells.push({
      date: dateStr,
      tokens: e?.tokens ?? 0,
      cost: e?.cost ?? 0,
      events: e?.events ?? 0,
      weekday,
      col,
    });
  }

  const cellHtml = cells
    .map((c) => {
      const intensity = maxTokens > 0 && c.tokens > 0
        ? Math.max(0.18, Math.log(1 + c.tokens) / Math.log(1 + maxTokens))
        : 0;
      const isActive = c.date === activeDate;
      const klass = ['hm-cell'];
      if (isActive) klass.push('hm-cell--active');
      if (c.tokens === 0) klass.push('hm-cell--empty');
      const tooltip = c.tokens > 0
        ? `${formatHeatmapDate(c.date)} · ${formatHeatmapTokens(c.tokens)} · ${formatHeatmapCost(c.cost)}`
        : `${formatHeatmapDate(c.date)} · no events`;
      const style = c.tokens > 0
        ? `--hm-alpha:${intensity.toFixed(3)};grid-column:${c.col + 1};grid-row:${c.weekday + 1};`
        : `grid-column:${c.col + 1};grid-row:${c.weekday + 1};`;
      // Empty days render as a non-link <span> — clicking them would land on
      // "0 flow blocks" with nothing to scrub, which is just confusing.
      if (c.tokens === 0) {
        return `<span class="${klass.join(' ')}" title="${esc(tooltip)}" data-date="${esc(c.date)}" style="${style}"></span>`;
      }
      return `<a class="${klass.join(' ')}" href="/?date=${esc(c.date)}" title="${esc(tooltip)}" data-date="${esc(c.date)}" style="${style}"></a>`;
    })
    .join('');

  // Month labels along the top: emit one label per week-column whose first
  // day is the start of a new month (or the very first column).
  const monthLabels: string[] = [];
  const seenMonths = new Set<string>();
  for (let week = 0; week < Math.ceil(HEATMAP_DAYS / 7); week++) {
    const firstDay = cells.find((c) => c.col === week);
    if (!firstDay) continue;
    const d = new Date(firstDay.date + 'T00:00:00Z');
    const monthKey = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    if (!seenMonths.has(monthKey)) {
      seenMonths.add(monthKey);
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      monthLabels.push(`<span style="grid-column:${week + 1}">${months[d.getUTCMonth()]}</span>`);
    }
  }

  return `
<section class="section heatmap-section">
  <div class="heatmap-head">
    <div class="kicker">// last 90 days · click any day to replay</div>
    <div class="heatmap-stats mono">
      <span><strong>${activeDays}</strong> active days</span>
      <span><strong>${formatHeatmapTokens(totalTokens)}</strong></span>
      <span><strong>${formatHeatmapCost(totalCost)}</strong></span>
    </div>
  </div>
  <div class="heatmap-wrap">
    <div class="heatmap-dow mono">
      <span></span>
      <span>Mon</span>
      <span></span>
      <span>Wed</span>
      <span></span>
      <span>Fri</span>
      <span></span>
    </div>
    <div class="heatmap-body">
      <div class="heatmap-months mono">${monthLabels.join('')}</div>
      <div class="heatmap-grid">${cellHtml}</div>
    </div>
  </div>
</section>`;
}

const FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;600&family=Geist:wght@400;500;600&display=swap';

export function generateReplayLiveHtml(report: ReplayReport, options: ReplayLiveHtmlOptions = {}): string {
  const safeReport = JSON.stringify(report);
  const dateLong = formatDateLong(report.date);
  const isEmpty = report.events.length === 0;
  const heatmap = options.heatmap ?? null;
  const activeDate = options.initialDate ?? report.date;

  const styles = `
:root {
  --bg: #0a0a0a;
  --surface: #111111;
  --surface-2: #161616;
  --border: rgba(255, 255, 255, 0.08);
  --border-strong: rgba(255, 255, 255, 0.16);
  --text: #ededed;
  --muted: #888888;
  --dim: #555555;
  --accent: #10b981;
  --accent-soft: rgba(16, 185, 129, 0.18);
  --warn: #fde68a;
  --shadow-glow: 0 0 24px rgba(16, 185, 129, 0.25);
  --mono: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  --sans: 'Geist', ui-sans-serif, system-ui, sans-serif;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--sans);
  font-size: 14px;
  line-height: 1.5;
  min-height: 100vh;
  overflow-x: hidden;
}
body::before {
  content: '';
  position: fixed;
  inset: 0;
  background-image: radial-gradient(rgba(255, 255, 255, 0.06) 1px, transparent 1px);
  background-size: 24px 24px;
  -webkit-mask-image: radial-gradient(ellipse at center, black 30%, transparent 75%);
  mask-image: radial-gradient(ellipse at center, black 30%, transparent 75%);
  pointer-events: none;
  z-index: 0;
}
.mono { font-family: var(--mono); }
.app {
  position: relative;
  z-index: 1;
  max-width: 1280px;
  margin: 0 auto;
  padding: 32px 24px 80px;
}
header.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 32px;
}
header.bar .brand {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
header.bar .brand .name {
  font-family: var(--mono);
  font-size: 14px;
  color: var(--text);
}
header.bar .brand .tag {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--dim);
  text-transform: uppercase;
  letter-spacing: 0.18em;
  border: 1px solid var(--border);
  padding: 2px 6px;
  border-radius: 4px;
}
header.bar .meta {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--muted);
}
header.bar .meta strong {
  color: var(--text);
  font-weight: 500;
}

.section { margin-bottom: 28px; }
.kicker {
  font-family: var(--mono);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--dim);
  margin-bottom: 8px;
}

/* Cost odometer */
.odometer-wrap {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 24px;
  flex-wrap: wrap;
}
.odometer {
  font-family: var(--mono);
  font-weight: 500;
  font-size: clamp(2.5rem, 8vw, 5rem);
  color: var(--text);
  letter-spacing: -0.02em;
  line-height: 1;
  text-shadow: 0 0 0 transparent;
  transition: text-shadow 200ms ease;
}
.odometer .currency { color: var(--dim); margin-right: 4px; }
.odometer.flash { text-shadow: var(--shadow-glow); }
.odometer-stats {
  display: flex;
  gap: 22px;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--muted);
}
.odometer-stats .stat strong {
  display: block;
  color: var(--text);
  font-size: 17px;
  font-weight: 500;
  margin-bottom: 2px;
}

/* Timeline */
.timeline-card {
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  padding: 18px 18px 14px;
}
.timeline-svg {
  display: block;
  width: 100%;
  height: 180px;
  cursor: ew-resize;
  user-select: none;
  touch-action: none;
}
.timeline-axis {
  display: flex;
  justify-content: space-between;
  font-family: var(--mono);
  font-size: 10px;
  color: var(--dim);
  margin-top: 6px;
  letter-spacing: 0.04em;
}

/* Transport */
.transport {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 4px 6px;
  flex-wrap: wrap;
}
.transport-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}
.btn {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--border);
  padding: 7px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: border-color 140ms ease, color 140ms ease, background 140ms ease;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.btn:hover { border-color: var(--border-strong); }
.btn.primary {
  border-color: var(--accent);
  color: var(--accent);
  min-width: 96px;
  justify-content: center;
}
.btn.primary:hover { background: rgba(16, 185, 129, 0.06); }
.btn .ico { font-size: 11px; line-height: 1; }
.speed-group {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.speed-group .btn {
  border: none;
  border-radius: 0;
  padding: 7px 10px;
  background: transparent;
  color: var(--muted);
}
.speed-group .btn + .btn { border-left: 1px solid var(--border); }
.speed-group .btn.active {
  color: var(--accent);
  background: var(--accent-soft);
}
.transport .clock {
  font-family: var(--mono);
  font-size: 13px;
  color: var(--text);
  letter-spacing: 0.04em;
  min-width: 84px;
  text-align: right;
}

/* Body grid */
.grid {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) minmax(0, 1.6fr);
  gap: 18px;
  margin-top: 18px;
}
@media (max-width: 880px) {
  .grid { grid-template-columns: 1fr; }
}
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 18px;
  position: relative;
}
.card .label {
  font-family: var(--mono);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--dim);
  margin-bottom: 10px;
}
.card.active {
  border-color: rgba(16, 185, 129, 0.45);
  box-shadow: 0 0 0 1px rgba(16, 185, 129, 0.2) inset;
}

/* Active block panel */
.block-headline {
  font-family: var(--mono);
  font-size: 16px;
  color: var(--text);
  margin-bottom: 4px;
}
.block-sub {
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--muted);
  margin-bottom: 14px;
}
.block-stats {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px 14px;
}
.block-stat {
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--muted);
}
.block-stat strong {
  display: block;
  color: var(--text);
  font-size: 14px;
  font-weight: 500;
}
.kind-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border-radius: 999px;
  font-family: var(--mono);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  border: 1px solid var(--border);
  color: var(--muted);
}
.kind-pill.deep { color: var(--accent); border-color: rgba(16, 185, 129, 0.4); }
.kind-pill.quick { color: var(--warn); border-color: rgba(253, 224, 71, 0.4); }
.kind-pill.mod { color: var(--muted); }
.kind-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

/* Event list */
.event-list-wrap {
  height: 320px;
  position: relative;
  overflow: hidden;
  border-top: 1px solid var(--border);
  margin-top: 14px;
  padding-top: 12px;
}
#eventList {
  height: 100%;
  overflow-y: auto;
  scroll-behavior: smooth;
  font-family: var(--mono);
  font-size: 12px;
}
#eventList::-webkit-scrollbar { width: 6px; }
#eventList::-webkit-scrollbar-track { background: transparent; }
#eventList::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 3px; }
.event-row {
  display: grid;
  grid-template-columns: 60px 1fr 70px 60px;
  gap: 12px;
  padding: 6px 4px;
  border-left: 2px solid transparent;
  color: var(--muted);
  align-items: baseline;
}
.event-row .t { color: var(--dim); }
.event-row .m { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.event-row .tk { color: var(--muted); text-align: right; }
.event-row .c { color: var(--accent); text-align: right; }
.event-row.future { opacity: 0.35; }
.event-row.current {
  border-left-color: var(--accent);
  background: rgba(16, 185, 129, 0.05);
  color: var(--text);
}
.event-row.current .t { color: var(--text); }

/* Mix donut + pills */
.mix-block {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 18px;
  align-items: center;
}
@media (max-width: 540px) {
  .mix-block { grid-template-columns: 1fr; }
}
.mix-svg {
  width: 140px;
  height: 140px;
  display: block;
}
.mix-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-family: var(--mono);
  font-size: 12px;
}
.mix-row {
  display: grid;
  grid-template-columns: 12px 1fr auto;
  gap: 8px;
  align-items: baseline;
  color: var(--muted);
}
.mix-row .swatch {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  display: inline-block;
}
.mix-row .name { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mix-row .pct { color: var(--muted); text-align: right; }

.summary-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 8px;
  margin-top: 14px;
}
.summary-pill {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
  border: 1px solid var(--border);
  padding: 4px 9px;
  border-radius: 999px;
}
.summary-pill strong { color: var(--text); font-weight: 500; }

/* GitHub-style heatmap for in-page date navigation */
.heatmap-section {
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  padding: 16px 18px;
}
.heatmap-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 12px;
}
.heatmap-stats {
  display: flex;
  gap: 16px;
  font-size: 11.5px;
  color: var(--muted);
}
.heatmap-stats strong { color: var(--text); font-weight: 500; margin-right: 4px; }
.heatmap-wrap {
  display: flex;
  align-items: stretch;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 4px;
}
.heatmap-dow {
  display: grid;
  grid-template-rows: repeat(7, 14px);
  gap: 3px;
  font-size: 9px;
  color: var(--dim);
  padding-top: 18px; /* line up with cells, accounting for the months row above */
  flex: 0 0 auto;
}
.heatmap-dow span { line-height: 14px; }
.heatmap-body {
  flex: 0 0 auto;
}
.heatmap-months {
  display: grid;
  grid-template-columns: repeat(13, 14px);
  gap: 3px;
  font-size: 9px;
  color: var(--dim);
  height: 14px;
  margin-bottom: 4px;
}
.heatmap-months span { grid-row: 1; white-space: nowrap; }
.heatmap-grid {
  display: grid;
  grid-template-rows: repeat(7, 14px);
  grid-template-columns: repeat(13, 14px);
  gap: 3px;
}
.hm-cell {
  display: block;
  width: 14px;
  height: 14px;
  border-radius: 3px;
  background: rgba(16, 185, 129, calc(var(--hm-alpha, 0.18) * 0.9));
  border: 1px solid transparent;
  cursor: pointer;
  transition: transform 100ms ease, border-color 100ms ease, box-shadow 100ms ease;
  text-decoration: none;
}
.hm-cell:hover {
  border-color: var(--accent);
  transform: scale(1.2);
}
.hm-cell--empty {
  background: rgba(255, 255, 255, 0.03);
  border-color: var(--border);
  cursor: default;
}
.hm-cell--empty:hover {
  border-color: var(--border);
  transform: none;
}
.hm-cell--active {
  border-color: var(--text) !important;
  box-shadow: 0 0 0 1px var(--bg), 0 0 0 2px var(--accent);
}

/* Help footer */
.help {
  margin-top: 24px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--dim);
  letter-spacing: 0.04em;
}
.help kbd {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 1px 5px;
  margin-right: 3px;
  color: var(--muted);
  font-family: var(--mono);
}

/* Empty state */
.empty {
  text-align: center;
  padding: 80px 24px;
  border: 1px dashed var(--border-strong);
  border-radius: 10px;
  background: var(--surface);
}
.empty h2 {
  font-family: var(--mono);
  font-size: 16px;
  margin-bottom: 8px;
  color: var(--text);
}
.empty p {
  font-family: var(--mono);
  font-size: 12.5px;
  color: var(--muted);
}
`;

  const emptyBody = `
<div class="empty">
  <h2>nothing happened on ${esc(report.date)}</h2>
  <p>no provider events on this day · try <span class="mono">tokenleak replay &lt;another-date&gt; --interactive</span></p>
</div>`;

  const mainBody = `
<section class="section odometer-wrap">
  <div>
    <div class="kicker">// cumulative cost</div>
    <div class="odometer mono" id="odometer"><span class="currency">$</span><span id="odoVal">0.00</span></div>
  </div>
  <div class="odometer-stats">
    <div class="stat"><strong id="statTokens">0</strong>tokens</div>
    <div class="stat"><strong id="statEvents">0</strong>events</div>
    <div class="stat"><strong id="statCacheRate">0%</strong>cache hit</div>
  </div>
</section>

<section class="section timeline-card">
  <div class="kicker">// drag to scrub · click a block to jump · space to play</div>
  <svg class="timeline-svg" id="timeline" viewBox="0 0 1000 180" preserveAspectRatio="none" aria-label="day timeline"></svg>
  <div class="timeline-axis">
    <span id="axisStart">--:--</span>
    <span id="axisMid">--:--</span>
    <span id="axisEnd">--:--</span>
  </div>
  <div class="transport">
    <div class="transport-controls">
      <button class="btn primary" id="btnPlay" type="button"><span class="ico" id="playIco">▶</span><span id="playLabel">play</span></button>
      <button class="btn" id="btnHome" type="button" title="jump to start (Home)"><span class="ico">⏮</span></button>
      <button class="btn" id="btnEnd" type="button" title="jump to end (End)"><span class="ico">⏭</span></button>
    </div>
    <div class="speed-group" role="group" aria-label="playback speed">
      <button class="btn" data-speed="60" type="button">60×</button>
      <button class="btn active" data-speed="240" type="button">240×</button>
      <button class="btn" data-speed="600" type="button">600×</button>
    </div>
    <div class="clock mono" id="clock">--:--:--</div>
  </div>
</section>

<div class="grid">
  <div class="card" id="blockCard">
    <div class="label">// active flow block</div>
    <div class="block-headline mono" id="blockHeadline">—</div>
    <div class="block-sub mono" id="blockSub"><span class="kind-pill mod" id="blockKind"><span class="kind-dot"></span><span id="blockKindLabel">idle</span></span></div>
    <div class="block-stats">
      <div class="block-stat"><strong id="blockModel">—</strong>dominant model</div>
      <div class="block-stat"><strong id="blockEvents">0</strong>events</div>
      <div class="block-stat"><strong id="blockTokens">0</strong>tokens</div>
      <div class="block-stat"><strong id="blockCost">$0.00</strong>cost</div>
      <div class="block-stat"><strong id="blockCache">—</strong>cache trend</div>
      <div class="block-stat"><strong id="blockSwitches">0</strong>model switches</div>
    </div>
    <div class="event-list-wrap">
      <div class="label" style="margin-bottom: 8px;">// events</div>
      <div id="eventList"></div>
    </div>
  </div>

  <div class="card">
    <div class="label">// model mix · cumulative</div>
    <div class="mix-block">
      <svg class="mix-svg" id="mixSvg" viewBox="0 0 100 100" aria-label="model mix donut"></svg>
      <div class="mix-list" id="mixList"></div>
    </div>
    <div class="summary-pills" id="summaryPills"></div>
  </div>
</div>

<div class="help">
  <span><kbd>space</kbd>play / pause</span>
  <span><kbd>←</kbd><kbd>→</kbd>step ±1 min</span>
  <span><kbd>shift</kbd>+<kbd>←</kbd><kbd>→</kbd>±10 min</span>
  <span><kbd>home</kbd><kbd>end</kbd>jump</span>
  <span><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd>speed</span>
</div>`;

  const script = `
(function () {
  const data = window.__REPLAY__;
  if (!data || !data.events || data.events.length === 0) return;

  // Color palette (mirrors landing).
  const ACCENT = '#10b981';
  const MUTED = '#888888';
  const DIM = '#555555';
  const WARN = '#fde68a';
  const PALETTE = [
    '#10b981', '#fde68a', '#a5b4fc', '#fb7185', '#67e8f9',
    '#c4b5fd', '#fcd34d', '#7dd3fc', '#f9a8d4', '#86efac',
  ];

  const events = data.events.map(function (e) {
    return Object.assign({}, e, { ts: Date.parse(e.timestamp) });
  });
  events.sort(function (a, b) { return a.ts - b.ts; });

  const flowBlocks = data.flowBlocks.map(function (b) {
    return Object.assign({}, b, {
      startTs: Date.parse(b.start),
      endTs: Date.parse(b.end),
    });
  });

  const velocity = data.tokenVelocity.map(function (v) {
    return { t: Date.parse(v.minute), tpm: v.tokensPerMinute };
  });

  // Day window: from earliest to latest event, padded to clean minutes.
  const dayStart = Math.min.apply(null, events.map(function (e) { return e.ts; }));
  const dayEnd = Math.max.apply(null, events.map(function (e) { return e.ts; }));
  const dayDuration = Math.max(1, dayEnd - dayStart);

  // Pre-computed model totals across whole day, used to assign stable colors.
  const modelTotals = new Map();
  events.forEach(function (e) {
    modelTotals.set(e.model, (modelTotals.get(e.model) || 0) + (e.totalTokens || 0));
  });
  const sortedModels = Array.from(modelTotals.entries())
    .sort(function (a, b) { return b[1] - a[1]; })
    .map(function (entry) { return entry[0]; });
  const modelColor = new Map();
  sortedModels.forEach(function (model, i) {
    modelColor.set(model, PALETTE[i % PALETTE.length]);
  });

  // ── State ──────────────────────────────────────────────────────────
  let currentTimeMs = dayStart;
  let isPlaying = false;
  let speed = 240;
  let lastFrameTs = 0;
  let rafId = 0;
  let prevCost = 0;

  // ── DOM refs ───────────────────────────────────────────────────────
  const $ = function (id) { return document.getElementById(id); };
  const tl = $('timeline');
  const odoVal = $('odoVal');
  const odo = $('odometer');
  const clock = $('clock');
  const playIco = $('playIco');
  const playLabel = $('playLabel');
  const eventList = $('eventList');
  const mixSvg = $('mixSvg');
  const mixList = $('mixList');
  const summaryPills = $('summaryPills');
  const blockCard = $('blockCard');
  const blockHeadline = $('blockHeadline');
  const blockKind = $('blockKind');
  const blockKindLabel = $('blockKindLabel');
  const blockModel = $('blockModel');
  const blockEvents = $('blockEvents');
  const blockTokens = $('blockTokens');
  const blockCost = $('blockCost');
  const blockCache = $('blockCache');
  const blockSwitches = $('blockSwitches');

  // ── Static SVG render ──────────────────────────────────────────────
  const TL_W = 1000;
  const TL_H = 180;
  const HIST_TOP = 12;
  const HIST_HEIGHT = 110;
  const RIBBON_TOP = 138;
  const RIBBON_HEIGHT = 26;

  function timeToX(ts) {
    return ((ts - dayStart) / dayDuration) * TL_W;
  }
  function xToTime(x) {
    const pct = Math.max(0, Math.min(1, x / TL_W));
    return dayStart + pct * dayDuration;
  }

  function renderTimelineStatic() {
    const maxTpm = Math.max.apply(null, velocity.map(function (v) { return v.tpm; })) || 1;
    const parts = [];

    // Baseline grid
    parts.push('<line x1="0" y1="' + (HIST_TOP + HIST_HEIGHT) + '" x2="' + TL_W + '" y2="' + (HIST_TOP + HIST_HEIGHT) + '" stroke="' + DIM + '" stroke-opacity="0.4" stroke-width="0.5"/>');

    // Velocity histogram bars (one per minute bucket).
    velocity.forEach(function (v) {
      const x = timeToX(v.t);
      const w = Math.max(0.8, TL_W / Math.max(velocity.length, 1) - 0.5);
      const h = Math.log(1 + v.tpm) / Math.log(1 + maxTpm) * HIST_HEIGHT;
      const y = HIST_TOP + HIST_HEIGHT - h;
      const alpha = 0.35 + 0.55 * (v.tpm / maxTpm);
      parts.push('<rect x="' + x.toFixed(2) + '" y="' + y.toFixed(2) + '" width="' + w.toFixed(2) + '" height="' + h.toFixed(2) + '" fill="' + ACCENT + '" fill-opacity="' + alpha.toFixed(2) + '"/>');
    });

    // Flow block ribbon. Min width bumped to 10 SVG units (~12px on screen)
    // so short bursts (Quick Lookups, 30s–3min Deep Flows) stay visible
    // instead of collapsing into invisible 2px slivers. Centered around
    // the block's true midpoint so visual position remains accurate.
    flowBlocks.forEach(function (b, i) {
      const xStart = timeToX(b.startTs);
      const xEnd = timeToX(b.endTs);
      const trueWidth = Math.max(0, xEnd - xStart);
      const minWidth = 10;
      const w = Math.max(minWidth, trueWidth);
      const x = trueWidth < minWidth
        ? Math.max(0, xStart + trueWidth / 2 - minWidth / 2)
        : xStart;
      const colorMap = { 'Deep Flow': ACCENT, 'Quick Lookup': WARN, 'Moderate Session': MUTED };
      const fill = colorMap[b.label] || MUTED;
      parts.push('<rect data-block="' + i + '" x="' + x.toFixed(2) + '" y="' + RIBBON_TOP + '" width="' + w.toFixed(2) + '" height="' + RIBBON_HEIGHT + '" rx="3" fill="' + fill + '" fill-opacity="0.55" stroke="' + fill + '" stroke-opacity="0.95" stroke-width="1" style="cursor:pointer"/>');
    });

    // Playhead (drawn last, on top).
    parts.push('<line id="playhead" x1="0" y1="' + HIST_TOP + '" x2="0" y2="' + (RIBBON_TOP + RIBBON_HEIGHT) + '" stroke="' + ACCENT + '" stroke-width="1.5"/>');
    parts.push('<circle id="playhead-dot" cx="0" cy="' + (HIST_TOP + HIST_HEIGHT + 4) + '" r="3.5" fill="' + ACCENT + '"/>');

    tl.innerHTML = parts.join('');
  }

  // ── Axis labels ────────────────────────────────────────────────────
  function fmtClock(ts) {
    const d = new Date(ts);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
  }
  function fmtClockShort(ts) {
    const d = new Date(ts);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function fmtTokens(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return Math.round(n).toString();
  }
  function fmtCost(n) { return '$' + (n || 0).toFixed(2); }
  function fmtPct(n) { return Math.round(n * 100) + '%'; }
  function fmtDuration(ms) {
    if (ms <= 0) return '0s';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    if (h > 0) return h + 'h ' + m + 'm';
    return m + 'm';
  }

  $('axisStart').textContent = fmtClockShort(dayStart);
  $('axisMid').textContent = fmtClockShort(dayStart + dayDuration / 2);
  $('axisEnd').textContent = fmtClockShort(dayEnd);

  // ── Cumulative computation up to currentTimeMs ─────────────────────
  function computeCumulative(t) {
    let cost = 0;
    let tokens = 0;
    let inputT = 0;
    let cacheReadT = 0;
    let count = 0;
    const mix = new Map();
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.ts > t) break;
      cost += e.cost || 0;
      tokens += e.totalTokens || 0;
      inputT += (e.inputTokens || 0);
      cacheReadT += (e.cacheReadTokens || 0);
      count++;
      mix.set(e.model, (mix.get(e.model) || 0) + (e.totalTokens || 0));
    }
    return { cost: cost, tokens: tokens, count: count, mix: mix, inputT: inputT, cacheReadT: cacheReadT };
  }

  // Pad short blocks to a minimum hit-test window. Playback advances
  // currentTimeMs by dt*speed each frame (multi-second jumps at high speeds),
  // so a block whose [startTs,endTs] interval is shorter than that jump can
  // be stepped over without ever landing inside it. The pad keeps the block
  // active while the playhead is in its neighborhood, falling back to its
  // nearest neighbor's gap so adjacent blocks stay disjoint.
  const ACTIVE_BLOCK_MIN_PAD_MS = 30_000;
  function activeBlockIndex(t) {
    for (let i = 0; i < flowBlocks.length; i++) {
      const b = flowBlocks[i];
      if (b.durationMs >= ACTIVE_BLOCK_MIN_PAD_MS * 2) {
        if (t >= b.startTs && t <= b.endTs) return i;
        continue;
      }
      const prevEnd = i > 0 ? flowBlocks[i - 1].endTs : -Infinity;
      const nextStart = i + 1 < flowBlocks.length ? flowBlocks[i + 1].startTs : Infinity;
      const padBefore = Math.min(ACTIVE_BLOCK_MIN_PAD_MS, Math.max(0, (b.startTs - prevEnd) / 2));
      const padAfter = Math.min(ACTIVE_BLOCK_MIN_PAD_MS, Math.max(0, (nextStart - b.endTs) / 2));
      if (t >= b.startTs - padBefore && t <= b.endTs + padAfter) return i;
    }
    return -1;
  }

  // ── Renderers ──────────────────────────────────────────────────────
  function renderPlayhead() {
    const x = timeToX(currentTimeMs);
    const head = document.getElementById('playhead');
    const dot = document.getElementById('playhead-dot');
    if (head) head.setAttribute('transform', 'translate(' + x.toFixed(2) + ', 0)');
    if (dot) dot.setAttribute('transform', 'translate(' + x.toFixed(2) + ', 0)');
    clock.textContent = fmtClock(currentTimeMs);
  }

  function renderOdometer(cum) {
    odoVal.textContent = cum.cost.toFixed(2);
    if (cum.cost > prevCost + 0.0001) {
      odo.classList.add('flash');
      setTimeout(function () { odo.classList.remove('flash'); }, 200);
    }
    prevCost = cum.cost;
    $('statTokens').textContent = fmtTokens(cum.tokens);
    $('statEvents').textContent = String(cum.count);
    const cacheRate = cum.inputT + cum.cacheReadT > 0
      ? cum.cacheReadT / (cum.inputT + cum.cacheReadT)
      : 0;
    $('statCacheRate').textContent = fmtPct(cacheRate);
  }

  function renderActiveBlock() {
    const idx = activeBlockIndex(currentTimeMs);
    if (idx === -1) {
      blockCard.classList.remove('active');
      blockHeadline.textContent = 'idle';
      blockKindLabel.textContent = 'between blocks';
      blockKind.className = 'kind-pill mod';
      blockModel.textContent = '—';
      blockEvents.textContent = '0';
      blockTokens.textContent = '0';
      blockCost.textContent = '$0.00';
      blockCache.textContent = '—';
      blockSwitches.textContent = '0';
      return;
    }
    const b = flowBlocks[idx];
    blockCard.classList.add('active');
    blockHeadline.textContent = fmtClockShort(b.startTs) + ' → ' + fmtClockShort(b.endTs);
    const kindClass = b.label === 'Deep Flow' ? 'deep' : b.label === 'Quick Lookup' ? 'quick' : 'mod';
    blockKind.className = 'kind-pill ' + kindClass;
    blockKindLabel.textContent = b.label.toLowerCase() + ' · ' + fmtDuration(b.durationMs);
    blockModel.textContent = b.dominantModel;
    blockEvents.textContent = String(b.eventCount);
    blockTokens.textContent = fmtTokens(b.totalTokens);
    blockCost.textContent = fmtCost(b.cost);
    if (b.cacheHitRateTrend && b.cacheHitRateTrend.length > 0) {
      const first = b.cacheHitRateTrend[0];
      const last = b.cacheHitRateTrend[b.cacheHitRateTrend.length - 1];
      const arrow = last > first + 0.05 ? '↑' : last < first - 0.05 ? '↓' : '→';
      blockCache.textContent = fmtPct(first) + ' ' + arrow + ' ' + fmtPct(last);
    } else {
      blockCache.textContent = '—';
    }
    blockSwitches.textContent = String(b.modelSwitches || 0);
  }

  // ── Event list (virtualized — render only ±N around playhead) ──────
  const EV_WINDOW = 25;
  let lastWindowKey = '';
  function renderEventList() {
    // Find current event index (last event <= currentTimeMs).
    let cur = -1;
    for (let i = 0; i < events.length; i++) {
      if (events[i].ts <= currentTimeMs) cur = i; else break;
    }
    const start = Math.max(0, cur - EV_WINDOW);
    const end = Math.min(events.length, (cur === -1 ? 0 : cur) + EV_WINDOW + 1);
    const key = start + ':' + end + ':' + cur;
    if (key === lastWindowKey) return;
    lastWindowKey = key;

    const parts = [];
    for (let i = start; i < end; i++) {
      const e = events[i];
      const future = i > cur;
      const cls = 'event-row' + (future ? ' future' : '') + (i === cur ? ' current' : '');
      parts.push(
        '<div class="' + cls + '">' +
          '<span class="t">' + fmtClock(e.ts).slice(0, 5) + '</span>' +
          '<span class="m" title="' + escAttr(e.model) + '">' + escHtml(e.model) + '</span>' +
          '<span class="tk">' + fmtTokens(e.totalTokens) + '</span>' +
          '<span class="c">' + fmtCost(e.cost) + '</span>' +
        '</div>'
      );
    }
    eventList.innerHTML = parts.join('');
    // Auto-scroll to keep the current row centered.
    const currentEl = eventList.querySelector('.event-row.current');
    if (currentEl) {
      currentEl.scrollIntoView({ block: 'center', behavior: 'auto' });
    }
  }

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escAttr(s) { return escHtml(s).replace(/"/g, '&quot;'); }

  // ── Mix donut + list ───────────────────────────────────────────────
  function renderMix(cum) {
    const total = Array.from(cum.mix.values()).reduce(function (a, b) { return a + b; }, 0);
    const r = 38;
    const cx = 50;
    const cy = 50;
    const stroke = 14;

    let parts = ['<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="' + stroke + '"/>'];
    if (total > 0) {
      let offset = 0;
      const circumference = 2 * Math.PI * r;
      const entries = Array.from(cum.mix.entries()).sort(function (a, b) { return b[1] - a[1]; });
      entries.forEach(function (entry) {
        const model = entry[0];
        const tokens = entry[1];
        const pct = tokens / total;
        const len = pct * circumference;
        parts.push(
          '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none"' +
          ' stroke="' + (modelColor.get(model) || MUTED) + '"' +
          ' stroke-width="' + stroke + '"' +
          ' stroke-dasharray="' + len.toFixed(2) + ' ' + (circumference - len).toFixed(2) + '"' +
          ' stroke-dashoffset="' + (-offset).toFixed(2) + '"' +
          ' transform="rotate(-90 ' + cx + ' ' + cy + ')"/>'
        );
        offset += len;
      });
    }
    mixSvg.innerHTML = parts.join('');

    // List
    const total2 = total || 1;
    const sorted = Array.from(cum.mix.entries())
      .sort(function (a, b) { return b[1] - a[1]; })
      .slice(0, 6);
    if (sorted.length === 0) {
      mixList.innerHTML = '<div class="mix-row"><span></span><span class="name" style="color:var(--dim)">no usage yet</span><span class="pct"></span></div>';
    } else {
      mixList.innerHTML = sorted.map(function (entry) {
        const model = entry[0];
        const tokens = entry[1];
        const pct = (tokens / total2 * 100).toFixed(0);
        return (
          '<div class="mix-row">' +
            '<span class="swatch" style="background:' + (modelColor.get(model) || MUTED) + '"></span>' +
            '<span class="name" title="' + escAttr(model) + '">' + escHtml(model) + '</span>' +
            '<span class="pct">' + pct + '%</span>' +
          '</div>'
        );
      }).join('');
    }
  }

  // ── Summary pills (use ReplayDaySummary, static) ───────────────────
  (function renderSummaryPillsOnce() {
    const s = data.summary;
    const peak = s.peakMinute
      ? fmtTokens(s.peakMinute.tokensPerMinute) + ' tok/min @ ' + fmtClockShort(Date.parse(s.peakMinute.minute))
      : '—';
    summaryPills.innerHTML = [
      '<span class="summary-pill">sessions <strong>' + s.totalSessions + '</strong></span>',
      '<span class="summary-pill">events <strong>' + s.totalEvents + '</strong></span>',
      '<span class="summary-pill">flow <strong>' + fmtDuration(s.flowTimeMs) + '</strong></span>',
      '<span class="summary-pill">think <strong>' + fmtDuration(s.thinkTimeMs) + '</strong></span>',
      '<span class="summary-pill">flow ratio <strong>' + Math.round(s.flowThinkRatio * 100) + '%</strong></span>',
      '<span class="summary-pill">peak <strong>' + peak + '</strong></span>',
    ].join('');
  })();

  // ── The single render entry point ──────────────────────────────────
  function render() {
    renderPlayhead();
    const cum = computeCumulative(currentTimeMs);
    renderOdometer(cum);
    renderActiveBlock();
    renderEventList();
    renderMix(cum);
  }

  function setTime(t) {
    currentTimeMs = Math.max(dayStart, Math.min(dayEnd, t));
    render();
  }

  // ── Play loop ──────────────────────────────────────────────────────
  function tick(now) {
    if (!isPlaying) return;
    const dt = lastFrameTs ? now - lastFrameTs : 16.7;
    lastFrameTs = now;
    const next = currentTimeMs + dt * speed;
    if (next >= dayEnd) {
      setTime(dayEnd);
      pause();
      return;
    }
    setTime(next);
    rafId = requestAnimationFrame(tick);
  }
  function play() {
    if (currentTimeMs >= dayEnd) currentTimeMs = dayStart;
    isPlaying = true;
    lastFrameTs = 0;
    playIco.textContent = '⏸';
    playLabel.textContent = 'pause';
    rafId = requestAnimationFrame(tick);
  }
  function pause() {
    isPlaying = false;
    playIco.textContent = '▶';
    playLabel.textContent = 'play';
    if (rafId) cancelAnimationFrame(rafId);
  }
  function toggle() { isPlaying ? pause() : play(); }

  // ── Scrub interactions ─────────────────────────────────────────────
  function eventToTime(ev) {
    const rect = tl.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * TL_W;
    return xToTime(x);
  }
  let scrubbing = false;
  tl.addEventListener('pointerdown', function (ev) {
    scrubbing = true;
    tl.setPointerCapture(ev.pointerId);
    pause();
    setTime(eventToTime(ev));
    // If they clicked a block rect specifically, snap to its start.
    const target = ev.target;
    if (target && target.getAttribute && target.getAttribute('data-block')) {
      const idx = parseInt(target.getAttribute('data-block'), 10);
      if (!isNaN(idx) && flowBlocks[idx]) setTime(flowBlocks[idx].startTs);
    }
  });
  tl.addEventListener('pointermove', function (ev) {
    if (scrubbing) setTime(eventToTime(ev));
  });
  tl.addEventListener('pointerup', function (ev) {
    scrubbing = false;
    if (tl.hasPointerCapture(ev.pointerId)) tl.releasePointerCapture(ev.pointerId);
  });

  // Transport buttons
  $('btnPlay').addEventListener('click', toggle);
  $('btnHome').addEventListener('click', function () { pause(); setTime(dayStart); });
  $('btnEnd').addEventListener('click', function () { pause(); setTime(dayEnd); });
  document.querySelectorAll('.speed-group .btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const s = parseInt(btn.getAttribute('data-speed'), 10);
      if (!isNaN(s)) {
        speed = s;
        document.querySelectorAll('.speed-group .btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
      }
    });
  });

  // ── Keyboard shortcuts ─────────────────────────────────────────────
  document.addEventListener('keydown', function (ev) {
    if (ev.target && (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA')) return;
    switch (ev.key) {
      case ' ':
      case 'Spacebar':
        ev.preventDefault();
        toggle();
        break;
      case 'ArrowLeft':
        ev.preventDefault();
        pause();
        setTime(currentTimeMs - (ev.shiftKey ? 10 : 1) * 60000);
        break;
      case 'ArrowRight':
        ev.preventDefault();
        pause();
        setTime(currentTimeMs + (ev.shiftKey ? 10 : 1) * 60000);
        break;
      case 'Home':
        ev.preventDefault();
        pause();
        setTime(dayStart);
        break;
      case 'End':
        ev.preventDefault();
        pause();
        setTime(dayEnd);
        break;
      case '1':
        speed = 60; updateSpeedButtons();
        break;
      case '2':
        speed = 240; updateSpeedButtons();
        break;
      case '3':
        speed = 600; updateSpeedButtons();
        break;
    }
  });
  function updateSpeedButtons() {
    document.querySelectorAll('.speed-group .btn').forEach(function (b) {
      b.classList.toggle('active', parseInt(b.getAttribute('data-speed'), 10) === speed);
    });
  }

  // ── Initial render ─────────────────────────────────────────────────
  renderTimelineStatic();
  setTime(dayStart);
})();
`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>tokenleak replay · ${esc(report.date)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="${FONTS_HREF}" />
<style>${styles}</style>
</head>
<body>
<div class="app">
  <header class="bar">
    <div class="brand">
      <span class="name">tokenleak</span>
      <span class="tag">replay</span>
    </div>
    <div class="meta">
      <span><strong>${esc(dateLong)}</strong></span>
      <span>${report.summary.totalSessions} sessions</span>
      <span>${report.summary.totalEvents} events</span>
      <span>${report.flowBlocks.length} flow blocks</span>
    </div>
  </header>
  ${heatmap ? renderHeatmapSection(heatmap, activeDate) : ''}
  ${isEmpty ? emptyBody : mainBody}
</div>
<script>window.__REPLAY__ = ${escScript(safeReport)};</script>
<script>${script}</script>
</body>
</html>`;
}
