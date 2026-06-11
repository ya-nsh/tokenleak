import type { BlackBoxNode, BlackBoxTrace } from '@tokenleak/core';

export interface BlackBoxLiveHtmlOptions {
  targetIndex?: number;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escScript(json: string): string {
  return json
    .replace(/<\//g, '<\\/')
    .replace(new RegExp('\u2028', 'g'), '\\u2028')
    .replace(new RegExp('\u2029', 'g'), '\\u2029');
}

function formatCost(n: number): string {
  return `$${n.toFixed(n >= 10 ? 0 : 2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function selectedNode(trace: BlackBoxTrace): BlackBoxNode | null {
  const hot = trace.hotPathNodeIds[trace.hotPathNodeIds.length - 1];
  return trace.nodes.find((node) => node.id === hot) ?? trace.nodes[0] ?? null;
}

export function generateBlackBoxLiveHtml(
  trace: BlackBoxTrace,
  options: BlackBoxLiveHtmlOptions = {},
): string {
  const activeTargetIndex = options.targetIndex ?? 0;
  const initialNode = selectedNode(trace);
  const payload = escScript(JSON.stringify({
    trace,
    activeTargetIndex,
    selectedNodeId: initialNode?.id ?? null,
  }));

  const targetLabel = trace.target
    ? `${trace.target.label} · ${trace.target.date}`
    : `${trace.dateRange.since} to ${trace.dateRange.until}`;
  const summary = trace.target
    ? `${trace.target.eventCount} events · ${formatTokens(trace.target.tokens)} tokens · ${formatCost(trace.target.cost)}`
    : 'No event-level trace in this window';

  const targetLinks = trace.targets.slice(0, 18).map((target, index) => {
    const active = index === activeTargetIndex ? ' is-active' : '';
    return `<a class="target-pill${active}" href="/?target=${index}" title="${esc(target.sessionId)}">
      <span>${esc(target.label)}</span>
      <strong>${esc(formatCost(target.cost))}</strong>
    </a>`;
  }).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tokenleak Black Box</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;600;700&family=Geist:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
:root {
  --bg: #090b0f;
  --surface: #10141b;
  --surface-2: #141a23;
  --border: rgba(226, 232, 240, 0.12);
  --border-strong: rgba(226, 232, 240, 0.24);
  --text: #eef2f7;
  --muted: #94a3b8;
  --dim: #64748b;
  --cyan: #67e8f9;
  --blue: #60a5fa;
  --rose: #fb7185;
  --green: #34d399;
  --amber: #fbbf24;
  --violet: #c4b5fd;
  --mono: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  --sans: 'Geist', ui-sans-serif, system-ui, sans-serif;
}
* { box-sizing: border-box; }
html, body { min-height: 100%; }
body {
  margin: 0;
  background:
    linear-gradient(135deg, rgba(103, 232, 249, 0.08), transparent 32%),
    radial-gradient(circle at 80% 12%, rgba(52, 211, 153, 0.12), transparent 28%),
    var(--bg);
  color: var(--text);
  font-family: var(--sans);
  overflow: hidden;
}
body::before {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px);
  background-size: 42px 42px;
  mask-image: radial-gradient(circle at center, black 24%, transparent 78%);
}
.mono { font-family: var(--mono); }
.app {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-rows: auto 1fr;
  height: 100dvh;
  padding: 18px;
  gap: 14px;
}
.topbar {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) auto;
  gap: 18px;
  align-items: end;
  border: 1px solid var(--border);
  background: rgba(16, 20, 27, 0.78);
  backdrop-filter: blur(18px);
  padding: 16px 18px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);
}
.eyebrow {
  color: var(--cyan);
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
h1 {
  margin: 3px 0 0;
  font-size: clamp(26px, 4vw, 44px);
  line-height: 1;
  letter-spacing: 0;
}
.subtle { color: var(--muted); font-size: 13px; }
.top-stats {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}
.stat {
  min-width: 116px;
  border-left: 1px solid var(--border);
  padding-left: 12px;
}
.stat span {
  display: block;
  color: var(--dim);
  font-family: var(--mono);
  font-size: 10px;
  text-transform: uppercase;
}
.stat strong {
  display: block;
  margin-top: 2px;
  font-family: var(--mono);
  font-size: 16px;
}
.main {
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 370px;
  gap: 14px;
}
.graph-shell, .side {
  min-height: 0;
  border: 1px solid var(--border);
  background: rgba(16, 20, 27, 0.72);
  backdrop-filter: blur(18px);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);
}
.graph-shell {
  position: relative;
  overflow: hidden;
}
.graph-toolbar {
  position: absolute;
  top: 14px;
  left: 14px;
  right: 14px;
  z-index: 3;
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
button, .target-pill {
  appearance: none;
  border: 1px solid var(--border);
  background: rgba(20, 26, 35, 0.86);
  color: var(--text);
  font-family: var(--mono);
  font-size: 12px;
  border-radius: 999px;
  padding: 8px 11px;
  cursor: pointer;
  text-decoration: none;
  transition: transform 160ms ease, border-color 160ms ease, background 160ms ease;
}
button:hover, .target-pill:hover {
  border-color: var(--border-strong);
  background: rgba(30, 41, 59, 0.9);
}
button:active, .target-pill:active { transform: translateY(1px) scale(0.99); }
button.is-active {
  border-color: rgba(103, 232, 249, 0.62);
  color: var(--cyan);
}
.graph-meta {
  margin-left: auto;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 11px;
}
svg {
  width: 100%;
  height: 100%;
  display: block;
  cursor: grab;
  touch-action: none;
}
svg.is-panning { cursor: grabbing; }
.edge {
  stroke: rgba(148, 163, 184, 0.42);
  stroke-width: 1.2;
  fill: none;
}
.edge.cost { stroke: rgba(251, 113, 133, 0.72); stroke-width: 1.7; }
.edge.signal { stroke: rgba(251, 191, 36, 0.58); stroke-dasharray: 5 5; }
.edge.outcome { stroke: rgba(52, 211, 153, 0.65); }
.node-hit {
  fill: transparent;
  cursor: pointer;
}
.node-ring {
  fill: rgba(9, 11, 15, 0.92);
  stroke-width: 2.2;
  filter: drop-shadow(0 8px 18px rgba(0,0,0,0.28));
}
.node-dot { pointer-events: none; }
.node-label {
  fill: var(--text);
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 600;
  paint-order: stroke;
  stroke: rgba(9, 11, 15, 0.82);
  stroke-width: 4px;
}
.node-cost {
  fill: var(--muted);
  font-family: var(--mono);
  font-size: 10px;
  paint-order: stroke;
  stroke: rgba(9, 11, 15, 0.82);
  stroke-width: 4px;
}
.node.is-selected .node-ring { stroke-width: 4; }
.node.is-hidden-neighbor { opacity: 0.4; }
.empty {
  height: 100%;
  display: grid;
  place-items: center;
  text-align: center;
  padding: 32px;
}
.empty h2 { margin: 0 0 8px; font-size: 28px; }
.empty p { margin: 0; color: var(--muted); max-width: 56ch; }
.side {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  overflow: hidden;
}
.inspector {
  min-height: 0;
  overflow: auto;
  padding: 18px;
}
.panel-kicker {
  color: var(--cyan);
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.13em;
  text-transform: uppercase;
}
.node-title {
  margin: 8px 0 12px;
  font-size: 23px;
  line-height: 1.08;
}
.inspector-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin: 14px 0;
}
.metric {
  border-top: 1px solid var(--border);
  padding-top: 10px;
}
.metric span {
  display: block;
  color: var(--dim);
  font-family: var(--mono);
  font-size: 10px;
  text-transform: uppercase;
}
.metric strong {
  display: block;
  margin-top: 3px;
  font-family: var(--mono);
  font-size: 15px;
}
.reason {
  margin: 16px 0;
  color: var(--text);
  line-height: 1.5;
}
.details {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.details li {
  border-left: 1px solid var(--border-strong);
  color: var(--muted);
  padding-left: 10px;
  line-height: 1.45;
}
.snippet {
  margin: 14px 0;
  border: 1px solid var(--border);
  background: rgba(9, 11, 15, 0.5);
  padding: 11px;
  color: #dbeafe;
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.5;
}
.targets {
  border-top: 1px solid var(--border);
  padding: 14px;
  display: flex;
  gap: 8px;
  overflow-x: auto;
}
.target-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}
.target-pill.is-active {
  border-color: rgba(52, 211, 153, 0.64);
}
.target-pill strong { color: var(--green); }
.legend {
  position: absolute;
  left: 14px;
  bottom: 14px;
  z-index: 3;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 11px;
}
.legend span {
  border: 1px solid var(--border);
  background: rgba(9, 11, 15, 0.52);
  padding: 6px 8px;
}
.kbd {
  color: var(--text);
}
@media (max-width: 980px) {
  body { overflow: auto; }
  .app { height: auto; min-height: 100dvh; }
  .topbar, .main { grid-template-columns: 1fr; }
  .top-stats { justify-content: flex-start; }
  .graph-shell { min-height: 68dvh; }
  .side { min-height: 520px; }
}
  </style>
</head>
<body>
  <div class="app">
    <header class="topbar">
      <div>
        <div class="eyebrow">// Tokenleak Black Box</div>
        <h1>${esc(targetLabel)}</h1>
        <div class="subtle">${esc(summary)}</div>
      </div>
      <div class="top-stats">
        <div class="stat"><span>cost</span><strong>${esc(formatCost(trace.summary.totalCost))}</strong></div>
        <div class="stat"><span>tokens</span><strong>${esc(formatTokens(trace.summary.totalTokens))}</strong></div>
        <div class="stat"><span>waste</span><strong>${trace.summary.wasteSignals}</strong></div>
        <div class="stat"><span>cache</span><strong>${Math.round(trace.summary.cacheHitRate * 100)}%</strong></div>
      </div>
    </header>
    <main class="main">
      <section class="graph-shell">
        <div class="graph-toolbar">
          <button data-focus="all" class="is-active">all</button>
          <button data-focus="costly-path">cost path</button>
          <button data-focus="waste">waste</button>
          <button data-focus="churn">cache / churn</button>
          <button id="reveal-all">reveal all</button>
          <button id="reset-view">reset view</button>
          <span class="graph-meta">drag canvas · wheel zoom · click node expands</span>
        </div>
        <svg id="graph" role="img" aria-label="Interactive Black Box cost graph">
          <g id="viewport"></g>
        </svg>
        <div id="empty" class="empty" hidden>
          <div>
            <div class="eyebrow">// waiting for trace</div>
            <h2>No event graph available</h2>
            <p>Black Box needs event-level provider logs in the selected window. Try a wider date range or a provider that captures sessions and prompts.</p>
          </div>
        </div>
        <div class="legend">
          <span><span class="kbd">click</span> select + expand</span>
          <span><span class="kbd">drag</span> pan</span>
          <span><span class="kbd">wheel</span> zoom</span>
        </div>
      </section>
      <aside class="side">
        <div id="inspector" class="inspector"></div>
        <div class="targets">${targetLinks || '<span class="subtle">No trace targets found.</span>'}</div>
      </aside>
    </main>
  </div>
  <script id="blackbox-data" type="application/json">${payload}</script>
  <script>
(() => {
  const payload = JSON.parse(document.getElementById('blackbox-data').textContent);
  const trace = payload.trace;
  const svg = document.getElementById('graph');
  const viewport = document.getElementById('viewport');
  const empty = document.getElementById('empty');
  const inspector = document.getElementById('inspector');
  const nodesById = new Map(trace.nodes.map((node) => [node.id, node]));
  const edgeList = trace.edges || [];
  const adjacent = new Map();
  const outgoing = new Map();
  for (const node of trace.nodes) {
    adjacent.set(node.id, new Set());
    outgoing.set(node.id, new Set());
  }
  for (const edge of edgeList) {
    adjacent.get(edge.from)?.add(edge.to);
    adjacent.get(edge.to)?.add(edge.from);
    outgoing.get(edge.from)?.add(edge.to);
  }

  let selectedId = payload.selectedNodeId;
  let focus = 'all';
  let revealAll = false;
  let expanded = new Set([
    trace.nodes[0]?.id,
    selectedId,
    ...(trace.hotPathNodeIds || []),
    ...(trace.wasteNodeIds || []),
    ...(trace.churnNodeIds || []),
  ].filter(Boolean));
  let transform = { x: 0, y: 0, scale: 1 };
  let dragging = false;
  let dragStart = null;

  const kindColor = {
    session: '#67e8f9',
    'flow-block': '#60a5fa',
    event: '#e2e8f0',
    'model-switch': '#fbbf24',
    cache: '#c4b5fd',
    waste: '#fb7185',
    outcome: '#34d399',
  };

  const severitySize = { high: 24, medium: 19, low: 15, info: 13 };
  const focusSets = {
    all: null,
    'costly-path': new Set(trace.hotPathNodeIds || []),
    waste: new Set(trace.wasteNodeIds || []),
    churn: new Set(trace.churnNodeIds || []),
  };

  function htmlEscape(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  function money(value) {
    return '$' + Number(value || 0).toFixed(value >= 10 ? 0 : 2);
  }

  function tokens(value) {
    const n = Number(value || 0);
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return Math.round(n).toLocaleString('en-US');
  }

  function shouldShowByFocus(node) {
    if (focus === 'all') return true;
    if (node.kind === 'session') return true;
    return focusSets[focus]?.has(node.id) || (trace.hotPathNodeIds || []).includes(node.id);
  }

  function visibleNodeIds() {
    if (revealAll) {
      return new Set(trace.nodes.filter(shouldShowByFocus).map((node) => node.id));
    }
    const visible = new Set();
    for (const id of expanded) {
      const node = nodesById.get(id);
      if (node && shouldShowByFocus(node)) visible.add(id);
      for (const next of adjacent.get(id) || []) {
        const nextNode = nodesById.get(next);
        if (nextNode && shouldShowByFocus(nextNode)) visible.add(next);
      }
    }
    if (selectedId) visible.add(selectedId);
    return visible;
  }

  function computeLayout() {
    const width = svg.clientWidth || 900;
    const height = svg.clientHeight || 650;
    const cx = width / 2;
    const cy = height / 2;
    const byKind = new Map();
    for (const node of trace.nodes) {
      const list = byKind.get(node.kind) || [];
      list.push(node);
      byKind.set(node.kind, list);
    }
    const positions = new Map();
    const session = trace.nodes.find((node) => node.kind === 'session') || trace.nodes[0];
    if (session) positions.set(session.id, { x: cx, y: cy });

    const rings = [
      ['flow-block', Math.min(width, height) * 0.22, -90],
      ['event', Math.min(width, height) * 0.37, -120],
      ['waste', Math.min(width, height) * 0.31, 12],
      ['model-switch', Math.min(width, height) * 0.29, 46],
      ['cache', Math.min(width, height) * 0.29, 76],
      ['outcome', Math.min(width, height) * 0.33, 118],
    ];
    for (const [kind, radius, startAngle] of rings) {
      const list = byKind.get(kind) || [];
      const spread = kind === 'event' ? 250 : Math.max(80, list.length * 28);
      list.forEach((node, index) => {
        const step = list.length <= 1 ? 0 : spread / (list.length - 1);
        const deg = startAngle - spread / 2 + step * index;
        const rad = deg * Math.PI / 180;
        positions.set(node.id, {
          x: cx + Math.cos(rad) * radius,
          y: cy + Math.sin(rad) * radius,
        });
      });
    }
    return positions;
  }

  function edgeClass(edge) {
    return 'edge ' + edge.kind;
  }

  function applyTransform() {
    viewport.setAttribute('transform', 'translate(' + transform.x + ' ' + transform.y + ') scale(' + transform.scale + ')');
  }

  function renderInspector() {
    const node = selectedId ? nodesById.get(selectedId) : null;
    if (!node) {
      inspector.innerHTML = '<div class="panel-kicker">// inspector</div><h2 class="node-title">No node selected</h2><p class="reason">Click a graph node to expand its neighborhood and inspect why it matters.</p>';
      return;
    }
    const details = (node.details || []).map((item) => '<li>' + htmlEscape(item) + '</li>').join('');
    inspector.innerHTML = \`
      <div class="panel-kicker">// \${htmlEscape(node.kind)}</div>
      <h2 class="node-title">\${htmlEscape(node.label)}</h2>
      <div class="inspector-grid">
        <div class="metric"><span>cost</span><strong>\${money(node.cost)}</strong></div>
        <div class="metric"><span>tokens</span><strong>\${tokens(node.tokens)}</strong></div>
        <div class="metric"><span>provider</span><strong>\${htmlEscape(node.provider || '-')}</strong></div>
        <div class="metric"><span>model</span><strong>\${htmlEscape(node.model || '-')}</strong></div>
      </div>
      \${node.snippet ? '<div class="snippet">' + htmlEscape(node.snippet) + '</div>' : ''}
      <p class="reason">\${htmlEscape(node.reason)}</p>
      <ul class="details">\${details}</ul>
    \`;
  }

  function render() {
    if (trace.nodes.length === 0) {
      svg.hidden = true;
      empty.hidden = false;
      renderInspector();
      return;
    }

    svg.hidden = false;
    empty.hidden = true;
    const positions = computeLayout();
    const visible = visibleNodeIds();
    viewport.innerHTML = '';

    for (const edge of edgeList) {
      if (!visible.has(edge.from) || !visible.has(edge.to)) continue;
      const a = positions.get(edge.from);
      const b = positions.get(edge.to);
      if (!a || !b) continue;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('class', edgeClass(edge));
      line.setAttribute('x1', a.x);
      line.setAttribute('y1', a.y);
      line.setAttribute('x2', b.x);
      line.setAttribute('y2', b.y);
      viewport.appendChild(line);
    }

    for (const node of trace.nodes) {
      if (!visible.has(node.id)) continue;
      const p = positions.get(node.id);
      if (!p) continue;
      const radius = severitySize[node.severity] || 14;
      const color = kindColor[node.kind] || '#e2e8f0';
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.setAttribute('class', 'node' + (node.id === selectedId ? ' is-selected' : ''));
      group.setAttribute('transform', 'translate(' + p.x + ' ' + p.y + ')');
      group.setAttribute('tabindex', '0');
      group.setAttribute('role', 'button');
      group.setAttribute('aria-label', node.label);
      group.addEventListener('click', (event) => {
        event.stopPropagation();
        selectedId = node.id;
        expanded.add(node.id);
        for (const next of outgoing.get(node.id) || []) expanded.add(next);
        render();
      });

      const hit = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      hit.setAttribute('class', 'node-hit');
      hit.setAttribute('r', radius + 16);
      group.appendChild(hit);

      const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      ring.setAttribute('class', 'node-ring');
      ring.setAttribute('r', radius);
      ring.setAttribute('stroke', color);
      group.appendChild(ring);

      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('class', 'node-dot');
      dot.setAttribute('r', Math.max(4, radius * 0.28));
      dot.setAttribute('fill', color);
      group.appendChild(dot);

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('class', 'node-label');
      label.setAttribute('x', radius + 10);
      label.setAttribute('y', -2);
      label.textContent = node.label.length > 34 ? node.label.slice(0, 33) + '...' : node.label;
      group.appendChild(label);

      const cost = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      cost.setAttribute('class', 'node-cost');
      cost.setAttribute('x', radius + 10);
      cost.setAttribute('y', 13);
      cost.textContent = money(node.cost) + ' / ' + tokens(node.tokens) + ' tok';
      group.appendChild(cost);

      viewport.appendChild(group);
    }

    applyTransform();
    renderInspector();
  }

  svg.addEventListener('click', () => {
    if (!dragging) {
      selectedId = null;
      render();
    }
  });
  svg.addEventListener('pointerdown', (event) => {
    dragging = true;
    dragStart = { x: event.clientX - transform.x, y: event.clientY - transform.y };
    svg.classList.add('is-panning');
    svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener('pointermove', (event) => {
    if (!dragging || !dragStart) return;
    transform.x = event.clientX - dragStart.x;
    transform.y = event.clientY - dragStart.y;
    applyTransform();
  });
  svg.addEventListener('pointerup', (event) => {
    dragging = false;
    dragStart = null;
    svg.classList.remove('is-panning');
    svg.releasePointerCapture(event.pointerId);
  });
  svg.addEventListener('wheel', (event) => {
    event.preventDefault();
    const delta = event.deltaY > 0 ? 0.9 : 1.1;
    transform.scale = Math.max(0.35, Math.min(2.8, transform.scale * delta));
    applyTransform();
  }, { passive: false });

  document.querySelectorAll('[data-focus]').forEach((button) => {
    button.addEventListener('click', () => {
      focus = button.getAttribute('data-focus');
      document.querySelectorAll('[data-focus]').forEach((b) => b.classList.toggle('is-active', b === button));
      render();
    });
  });
  document.getElementById('reveal-all').addEventListener('click', () => {
    revealAll = !revealAll;
    document.getElementById('reveal-all').textContent = revealAll ? 'local view' : 'reveal all';
    render();
  });
  document.getElementById('reset-view').addEventListener('click', () => {
    transform = { x: 0, y: 0, scale: 1 };
    revealAll = false;
    expanded = new Set([trace.nodes[0]?.id, selectedId, ...(trace.hotPathNodeIds || [])].filter(Boolean));
    document.getElementById('reveal-all').textContent = 'reveal all';
    render();
  });
  window.addEventListener('resize', render);
  render();
})();
  </script>
</body>
</html>`;
}
