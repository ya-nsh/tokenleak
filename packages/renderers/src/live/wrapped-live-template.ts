import type { TokenleakOutput } from '@tokenleak/core';
import { formatNumber, formatCost } from '../svg/utils';
import { computeAchievements } from '../svg/wrapped-slides';

// ── Helpers ──────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const DAY_NAMES_MON_FIRST = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  return `${MONTH_SHORT[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, '0')}`;
}

function formatDateLong(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function diffDays(since: string, until: string): number {
  const s = new Date(since + 'T00:00:00Z');
  const u = new Date(until + 'T00:00:00Z');
  return Math.round((u.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}

const ICON_EMOJI: Record<string, string> = {
  fire: '\u{1F525}',
  moon: '\u{1F989}',
  sun: '\u{1F305}',
  diamond: '\u{1F4B8}',
  target: '\u26A1',
  circle: '\u{1F3B2}',
  calendar: '\u{1F4C5}',
  bolt: '\u26A1',
  mountain: '\u{1F3D4}',
  palette: '\u{1F500}',
  star: '\u2B50',
  rocket: '\u{1F680}',
  trophy: '\u{1F3C6}',
};

function guessProvider(model: string): string {
  const lower = model.toLowerCase();
  if (lower.includes('claude') || lower.includes('anthropic')) return 'Anthropic';
  if (lower.includes('gpt') || lower.includes('o1') || lower.includes('o3') || lower.includes('o4'))
    return 'OpenAI';
  if (lower.includes('gemini') || lower.includes('google')) return 'Google';
  return 'Other';
}

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: '#d4af5f',
  'claude-code': '#d4af5f',
  openai: '#3a5070',
  codex: '#3a5070',
  google: '#6a2535',
  pi: '#5a4a70',
};

function getProviderColor(provider: string): string {
  return PROVIDER_COLORS[provider.toLowerCase()] ?? '#555555';
}

// Strip the leading $ from formatCost output
function costValue(cost: number): string {
  const raw = formatCost(cost);
  return raw.startsWith('$') ? raw.slice(1) : raw;
}

// ── Main ─────────────────────────────────────────────────────────────

export function generateWrappedLiveHtml(output: TokenleakOutput): string {
  const stats = output.aggregated;
  const more = output.more;
  const providers = output.providers;
  const { since, until } = output.dateRange;
  const achievements = computeAchievements(output);
  const totalDaysInRange = diffDays(since, until);
  const year = until.slice(0, 4);

  // ── Stamp (reused on every slide) ──
  const stamp = `<div class="stamp"><span class="stamp-name">TokenLeak</span><span class="stamp-sep"></span><span class="stamp-tag">Built with TokenLeak</span></div>`;

  // ── Time of day (Slide 07) ──
  let morningPct = 25;
  let afternoonPct = 25;
  let eveningPct = 25;
  let nightPct = 25;
  let peakTimeName = 'Night';
  if (more?.hourOfDay) {
    const total = more.hourOfDay.reduce((s, e) => s + e.tokens, 0);
    if (total > 0) {
      const morning = more.hourOfDay
        .filter((e) => e.hour >= 6 && e.hour < 12)
        .reduce((s, e) => s + e.tokens, 0);
      const afternoon = more.hourOfDay
        .filter((e) => e.hour >= 12 && e.hour < 18)
        .reduce((s, e) => s + e.tokens, 0);
      const evening = more.hourOfDay
        .filter((e) => e.hour >= 18 && e.hour < 22)
        .reduce((s, e) => s + e.tokens, 0);
      const night = total - morning - afternoon - evening;
      morningPct = Math.round((morning / total) * 100);
      afternoonPct = Math.round((afternoon / total) * 100);
      eveningPct = Math.round((evening / total) * 100);
      nightPct = 100 - morningPct - afternoonPct - eveningPct;
      const max = Math.max(morningPct, afternoonPct, eveningPct, nightPct);
      if (max === morningPct) peakTimeName = 'Morning';
      else if (max === afternoonPct) peakTimeName = 'Afternoon';
      else if (max === eveningPct) peakTimeName = 'Evening';
      else peakTimeName = 'Night';
    }
  }

  // ── Day of week (Slide 06) ──
  const dowOrder = [1, 2, 3, 4, 5, 6, 0];
  const dowEntries = dowOrder.map((dayNum) => {
    const entry = stats.dayOfWeek.find((e) => e.day === dayNum);
    return {
      label: DAY_NAMES_MON_FIRST[dowOrder.indexOf(dayNum)],
      tokens: entry?.tokens ?? 0,
    };
  });
  const maxDowTokens = Math.max(...dowEntries.map((e) => e.tokens), 1);
  const dowData = dowEntries.map((e) => ({
    d: e.label,
    p: Math.round((e.tokens / maxDowTokens) * 100),
  }));
  const peakDowEntry = dowEntries.reduce(
    (a, b) => (b.tokens > a.tokens ? b : a),
    dowEntries[0],
  );
  const dayNameMap: Record<string, string> = {
    Mon: 'Monday',
    Tue: 'Tuesday',
    Wed: 'Wednesday',
    Thu: 'Thursday',
    Fri: 'Friday',
    Sat: 'Saturday',
    Sun: 'Sunday',
  };
  const peakDowName = dayNameMap[peakDowEntry.label] ?? peakDowEntry.label;
  const minDowEntry = dowEntries.reduce(
    (a, b) => (b.tokens < a.tokens ? b : a),
    dowEntries[0],
  );
  const minDowPct =
    maxDowTokens > 0
      ? Math.round((minDowEntry.tokens / maxDowTokens) * 100)
      : 0;
  const minDowName = dayNameMap[minDowEntry.label] ?? minDowEntry.label;

  // ── Provider mix (Slide 05) ──
  const totalProviderTokens = providers.reduce((s, p) => s + p.totalTokens, 0);
  const providerMix = providers
    .map((p) => ({
      name: p.displayName,
      pct:
        totalProviderTokens > 0
          ? Math.round((p.totalTokens / totalProviderTokens) * 100)
          : 0,
      color: getProviderColor(p.provider),
    }))
    .sort((a, b) => b.pct - a.pct);
  const pctSum = providerMix.reduce((s, p) => s + p.pct, 0);
  if (providerMix.length > 0 && pctSum !== 100) {
    providerMix[0].pct += 100 - pctSum;
  }

  // ── Top models (Slide 04) ──
  const topModels = stats.topModels.slice(0, 3);

  // ── Cache (Slide 08) ──
  const cacheHitPct = Math.round(stats.cacheHitRate * 100);
  const cacheReads = more?.cacheEconomics?.readTokens ?? 0;
  const cacheWrites = more?.cacheEconomics?.writeTokens ?? 0;
  const reuseRatio =
    more?.cacheEconomics?.reuseRatio ??
    (cacheWrites > 0 ? cacheReads / cacheWrites : 0);

  // ── Peak day (Slide 09) ──
  const peakDay = stats.peakDay;
  const peakMultiplier =
    peakDay && stats.averageDailyTokens > 0
      ? (peakDay.tokens / stats.averageDailyTokens).toFixed(1)
      : '0';
  const peakNovels = peakDay ? Math.round(peakDay.tokens / 3000) : 0;

  // ── Projection (Slide 11) ──
  const projectedCost =
    more?.monthlyBurn?.projectedCost ?? stats.averageDailyCost * 30;
  const projectedDollars = Math.floor(projectedCost);
  const projectedCents = Math.round((projectedCost - projectedDollars) * 100);
  const avgDailyCostStr =
    stats.averageDailyCost >= 1
      ? `$${stats.averageDailyCost.toFixed(2)}`
      : `$${stats.averageDailyCost.toFixed(4)}`;

  // ── Achievements / Badges (Slide 10) ──
  interface BadgeDef {
    emoji: string;
    name: string;
    sub: string;
  }
  const ALL_BADGES: BadgeDef[] = [
    { emoji: '\u{1F525}', name: 'Streak Master', sub: '>30 day streak' },
    { emoji: '\u{1F989}', name: 'Night Owl', sub: '>40% night tokens' },
    { emoji: '\u{1F4B8}', name: 'Big Spender', sub: '>$100 total' },
    { emoji: '\u26A1', name: 'Cache Master', sub: '>50% hit rate' },
    { emoji: '\u{1F4C5}', name: 'Daily Driver', sub: '>80% active days' },
    { emoji: '\u26A1', name: 'Power User', sub: '>10k avg tok/day' },
    { emoji: '\u{1F3D4}', name: 'Summit Day', sub: 'Peak >50k tokens' },
    { emoji: '\u{1F500}', name: 'Multi-Tool', sub: '\u22653 providers' },
    { emoji: '\u{1F305}', name: 'Early Bird', sub: '>40% morning' },
    { emoji: '\u{1F3B2}', name: 'Model Hopper', sub: '\u22654 models' },
  ];

  const earnedTitles = new Set(achievements.map((a) => a.title));
  const badgeHtml = ALL_BADGES.map((b) => {
    const on = earnedTitles.has(b.name);
    return `<div class="badge ${on ? 'on' : 'off'}"><span class="ico">${b.emoji}</span><div><div class="b-name">${esc(b.name)}</div><div class="b-sub">${esc(b.sub)}</div></div></div>`;
  }).join('\n');
  const earnedCount = ALL_BADGES.filter((b) => earnedTitles.has(b.name)).length;

  // ── Donut SVG (Slide 05) ──
  const circumference = 2 * Math.PI * 56; // ~351.86
  let donutSegments = '';
  let offset = -circumference / 4;
  for (const p of providerMix) {
    const dash = (p.pct / 100) * circumference;
    donutSegments += `<circle cx="75" cy="75" r="56" fill="none" stroke="${p.color}" stroke-width="16" stroke-linecap="butt" stroke-dasharray="${dash.toFixed(0)} ${circumference.toFixed(0)}" stroke-dashoffset="${(-offset).toFixed(0)}"/>`;
    offset -= dash;
  }

  // ── Cache ring SVG (Slide 08) ──
  const ringCircumference = 2 * Math.PI * 52; // ~326.73
  const ringDash = (cacheHitPct / 100) * ringCircumference;
  const ringOffset = ringCircumference / 4;

  // ── Build slides ──

  const slide01 = `<div class="slide active" id="s0">
  <div class="slide-tag"><em>01</em> &nbsp;/&nbsp; 12 &nbsp;&middot;&nbsp; Intro</div>
  <div class="eyebrow">Your year in code</div>
  <h1 class="hero">AI<br>Wrapped<br><span class="hl">&rsquo;${esc(year.slice(2))}</span></h1>
  <div class="dt-range"><em>${formatDate(since)}</em> &mdash; <em>${formatDate(until)}, ${esc(year)}</em></div>
  <div class="rule"></div>
  <div class="info">Claude Code &amp; Codex sessions &mdash; every token, every session, laid bare.</div>
  <div style="margin-top:10px;display:flex;align-items:center"><span class="pulse"></span><span style="font-family:'Space Mono',monospace;font-size:9px;color:var(--muted);letter-spacing:0.14em">${totalDaysInRange} DAYS OF DATA</span></div>
  <div style="margin-top:auto;padding-top:34px">${stamp}</div>
</div>`;

  const slide02 = `<div class="slide" id="s1">
  <div class="slide-tag"><em>02</em> &nbsp;/&nbsp; 12 &nbsp;&middot;&nbsp; The Big Numbers</div>
  <h2 class="title">You burned through<br><span class="hl">${esc(formatNumber(stats.totalTokens))}</span> tokens</h2>
  <div class="g2">
    <div class="sc">
      <div class="lb">Total Cost</div>
      <div class="vl"><span class="hl">$</span>${esc(costValue(stats.totalCost))}</div>
    </div>
    <div class="sc">
      <div class="lb">Active Days</div>
      <div class="vl">${stats.activeDays}<span class="un"> / ${stats.totalDays}</span></div>
    </div>
    <div class="sc">
      <div class="lb">Avg / Day</div>
      <div class="vl">${esc(formatNumber(stats.averageDailyTokens))}</div>
      <div class="un">TOKENS</div>
    </div>
    <div class="sc">
      <div class="lb">Avg Cost / Day</div>
      <div class="vl"><span class="hl">$</span>${esc(costValue(stats.averageDailyCost))}</div>
    </div>
  </div>
  <div style="margin-top:auto;padding-top:34px">${stamp}</div>
</div>`;

  // ── Slide 03 — Streak Story ──
  const slide03 = `<div class="slide" id="s2">
  <div class="slide-tag"><em>03</em> &nbsp;/&nbsp; 12 &nbsp;&middot;&nbsp; Streak Story</div>
  <h2 class="title">Your longest streak:<br><span class="hl">${stats.longestStreak} days</span></h2>
  <div class="g2">
    <div class="sc">
      <div class="lb">Current Streak</div>
      <div class="vl">${stats.currentStreak}</div>
      <div class="un">DAYS</div>
    </div>
    <div class="sc">
      <div class="lb">Longest Streak</div>
      <div class="vl">${stats.longestStreak}</div>
      <div class="un">DAYS</div>
    </div>
  </div>
  <div class="rule"></div>
  <div class="lb" style="margin-bottom:6px">ACTIVITY MAP</div>
  <div class="sdots" id="streakDots" data-current-streak="${stats.currentStreak}"></div>
  <div class="info">${stats.activeDays} active days out of ${totalDaysInRange} &mdash; that&rsquo;s a <span class="hi">${Math.round((stats.activeDays / Math.max(totalDaysInRange, 1)) * 100)}%</span> hit rate.</div>
  <div style="margin-top:auto;padding-top:34px">${stamp}</div>
</div>`;

  // ── Slide 04 — Top Models ──
  const modelBars = topModels
    .map((m, i) => {
      const prov = guessProvider(m.model);
      const rank = i === 0 ? '01' : i === 1 ? '02' : '03';
      return `<div class="bar">
  <div class="bar-top"><div><div class="bar-name">${esc(m.model)}</div><div class="bar-sub">${esc(prov)}</div></div><div class="bar-pct">${m.percentage.toFixed(1)}%</div></div>
  <div class="bar-track"><div class="bar-fill" style="width:${m.percentage}%"></div></div>
</div>`;
    })
    .join('\n');

  const slide04 = `<div class="slide" id="s3">
  <div class="slide-tag"><em>04</em> &nbsp;/&nbsp; 12 &nbsp;&middot;&nbsp; Top Models</div>
  <h2 class="title">Your go-to<br><span class="hl">models</span></h2>
  ${modelBars}
  <div class="rule"></div>
  <div class="info">You used <span class="hi">${stats.topModels.length} model${stats.topModels.length !== 1 ? 's' : ''}</span> total during this period.</div>
  <div style="margin-top:auto;padding-top:34px">${stamp}</div>
</div>`;

  // ── Slide 05 — Provider Mix ──
  const providerBars = providerMix
    .map(
      (p) =>
        `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px"><div style="width:10px;height:10px;border-radius:1px;background:${p.color};flex-shrink:0"></div><span style="font-size:14px;color:var(--text);flex:1">${esc(p.name)}</span><span class="bar-pct">${p.pct}%</span></div>`,
    )
    .join('\n');

  const slide05 = `<div class="slide" id="s4">
  <div class="slide-tag"><em>05</em> &nbsp;/&nbsp; 12 &nbsp;&middot;&nbsp; Provider Mix</div>
  <h2 class="title">Where your tokens<br><span class="hl">went</span></h2>
  <div style="display:flex;align-items:center;gap:32px;margin-bottom:24px">
    <svg width="150" height="150" viewBox="0 0 150 150">${donutSegments}</svg>
    <div style="flex:1">${providerBars}</div>
  </div>
  <div class="rule"></div>
  <div class="info"><span class="hi">${esc(formatNumber(totalProviderTokens))}</span> tokens across <span class="hi">${providers.length}</span> provider${providers.length !== 1 ? 's' : ''}.</div>
  <div style="margin-top:auto;padding-top:34px">${stamp}</div>
</div>`;

  // ── Slide 06 — Day of Week ──
  const slide06 = `<div class="slide" id="s5">
  <div class="slide-tag"><em>06</em> &nbsp;/&nbsp; 12 &nbsp;&middot;&nbsp; Day of Week</div>
  <h2 class="title"><span class="hl">${esc(peakDowName)}</span> is your<br>power day</h2>
  <div class="dow-row" id="dowGrid" data-dow='${JSON.stringify(dowData)}'></div>
  <div class="rule"></div>
  <div class="info">Quietest day: <span class="hi">${esc(minDowName)}</span> at ${minDowPct}% of peak. Even your off-days have tokens flowing.</div>
  <div style="margin-top:auto;padding-top:34px">${stamp}</div>
</div>`;

  // ── Slide 07 — Time of Day ──
  const timeSlots: Array<{
    ico: string;
    nm: string;
    pct: number;
    range: string;
  }> = [
    { ico: '\u{1F305}', nm: 'Morning', pct: morningPct, range: '6am \u2013 12pm' },
    { ico: '\u2600\uFE0F', nm: 'Afternoon', pct: afternoonPct, range: '12pm \u2013 6pm' },
    { ico: '\u{1F307}', nm: 'Evening', pct: eveningPct, range: '6pm \u2013 10pm' },
    { ico: '\u{1F319}', nm: 'Night', pct: nightPct, range: '10pm \u2013 6am' },
  ];
  const todCells = timeSlots
    .map(
      (t) =>
        `<div class="tod-cell${t.nm === peakTimeName ? ' hi' : ''}"><div class="tod-ico">${t.ico}</div><div class="tod-nm">${t.nm}</div><div class="tod-val"${t.nm === peakTimeName ? ' style="color:var(--gold)"' : ''}>${t.pct}%</div><div class="tod-sub">${t.range}</div></div>`,
    )
    .join('\n');

  const slide07 = `<div class="slide" id="s6">
  <div class="slide-tag"><em>07</em> &nbsp;/&nbsp; 12 &nbsp;&middot;&nbsp; Time of Day</div>
  <h2 class="title">Peak hours:<br><span class="hl">${esc(peakTimeName)}</span></h2>
  <div class="tod-grid">
    ${todCells}
  </div>
  <div class="rule"></div>
  <div class="info">Your <span class="hi">${esc(peakTimeName.toLowerCase())}</span> sessions carry the heaviest token load.</div>
  <div style="margin-top:auto;padding-top:34px">${stamp}</div>
</div>`;

  // ── Slide 08 — Cache Efficiency ──
  const slide08 = `<div class="slide" id="s7">
  <div class="slide-tag"><em>08</em> &nbsp;/&nbsp; 12 &nbsp;&middot;&nbsp; Cache Efficiency</div>
  <h2 class="title"><span class="hl">${cacheHitPct}%</span> cache<br>hit rate</h2>
  <div class="ring-wrap">
    <svg width="140" height="140" viewBox="0 0 140 140">
      <circle cx="70" cy="70" r="52" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="12"/>
      <circle cx="70" cy="70" r="52" fill="none" stroke="var(--gold)" stroke-width="12" stroke-linecap="round" stroke-dasharray="${ringDash.toFixed(0)} ${ringCircumference.toFixed(0)}" stroke-dashoffset="${ringOffset.toFixed(0)}" transform="rotate(-90 70 70)"/>
    </svg>
    <div class="ring-center">
      <div class="ring-pct">${cacheHitPct}%</div>
      <div class="ring-lb">HIT RATE</div>
    </div>
  </div>
  <div class="g2">
    <div class="sc">
      <div class="lb">Cache Reads</div>
      <div class="vl">${esc(formatNumber(cacheReads))}</div>
      <div class="un">TOKENS</div>
    </div>
    <div class="sc">
      <div class="lb">Cache Writes</div>
      <div class="vl">${esc(formatNumber(cacheWrites))}</div>
      <div class="un">TOKENS</div>
    </div>
  </div>
  <div class="rule"></div>
  <div class="info">Reuse ratio: <span class="hi">${reuseRatio !== null ? reuseRatio.toFixed(1) : '0'}x</span> &mdash; every write was read back ${reuseRatio !== null ? reuseRatio.toFixed(1) : '0'} times on average.</div>
  <div style="margin-top:auto;padding-top:34px">${stamp}</div>
</div>`;

  // ── Slide 09 — Peak Day ──
  const peakDayContent = peakDay
    ? `<div class="peak-box">
    <div class="peak-dt">${esc(formatDateLong(peakDay.date))}</div>
    <div class="peak-num">${esc(formatNumber(peakDay.tokens))}</div>
    <div class="peak-lb">TOKENS IN ONE DAY</div>
  </div>
  <div class="rule"></div>
  <div class="g2">
    <div class="sc">
      <div class="lb">vs Average</div>
      <div class="vl">${esc(peakMultiplier)}<span class="un">x</span></div>
    </div>
    <div class="sc">
      <div class="lb">\u2248 Novels</div>
      <div class="vl">${peakNovels}</div>
      <div class="un">@ 3K TOK EACH</div>
    </div>
  </div>`
    : `<div class="info">No peak day data available for this period.</div>`;

  const slide09 = `<div class="slide" id="s8">
  <div class="slide-tag"><em>09</em> &nbsp;/&nbsp; 12 &nbsp;&middot;&nbsp; Peak Day</div>
  <h2 class="title">Your biggest<br><span class="hl">single day</span></h2>
  ${peakDayContent}
  <div style="margin-top:auto;padding-top:34px">${stamp}</div>
</div>`;

  // ── Slide 10 — Achievements ──
  const slide10 = `<div class="slide" id="s9">
  <div class="slide-tag"><em>10</em> &nbsp;/&nbsp; 12 &nbsp;&middot;&nbsp; Achievements</div>
  <h2 class="title"><span class="hl">${earnedCount}</span> badges<br>unlocked</h2>
  <div class="badges">
    ${badgeHtml}
  </div>
  <div class="rule"></div>
  <div class="info">${earnedCount} of ${ALL_BADGES.length} badges earned. ${earnedCount >= ALL_BADGES.length ? 'You collected them all!' : `${ALL_BADGES.length - earnedCount} more to go.`}</div>
  <div style="margin-top:auto;padding-top:34px">${stamp}</div>
</div>`;

  // ── Slide 11 — Projection ──
  const slide11 = `<div class="slide" id="s10">
  <div class="slide-tag"><em>11</em> &nbsp;/&nbsp; 12 &nbsp;&middot;&nbsp; Projection</div>
  <h2 class="title">Your monthly<br><span class="hl">burn rate</span></h2>
  <div style="text-align:center;margin:16px 0 8px">
    <div class="proj-fig"><span class="c">$</span>${projectedDollars}<span class="c">.${String(projectedCents).padStart(2, '0')}</span></div>
    <div class="lb" style="margin-top:10px">PROJECTED / MONTH</div>
  </div>
  <div class="rule"></div>
  <div class="g2">
    <div class="sc">
      <div class="lb">Avg Daily Cost</div>
      <div class="vl"><span class="hl">$</span>${esc(costValue(stats.averageDailyCost))}</div>
    </div>
    <div class="sc">
      <div class="lb">Observed Days</div>
      <div class="vl">${more?.monthlyBurn?.observedDays ?? stats.activeDays}</div>
      <div class="un">OF ${more?.monthlyBurn?.calendarDays ?? totalDaysInRange}</div>
    </div>
  </div>
  <div class="rule"></div>
  <div class="info">At <span class="hi">${esc(avgDailyCostStr)}</span> per day, you&rsquo;re on track for <span class="hi">$${projectedDollars}.${String(projectedCents).padStart(2, '0')}</span> this month.</div>
  <div style="margin-top:auto;padding-top:34px">${stamp}</div>
</div>`;

  // ── Slide 12 — Fin ──
  const generatedAt = new Date().toISOString();
  const slide12 = `<div class="slide" id="s11">
  <div class="slide-tag"><em>12</em> &nbsp;/&nbsp; 12 &nbsp;&middot;&nbsp; Fin</div>
  <div class="foot-body">
    <h2 class="title" style="text-align:center">That&rsquo;s a wrap,<br><span class="hl">&rsquo;${esc(year.slice(2))}</span></h2>
    <div class="g2" style="width:100%">
      <div class="sc">
        <div class="lb">Total Tokens</div>
        <div class="vl">${esc(formatNumber(stats.totalTokens))}</div>
      </div>
      <div class="sc">
        <div class="lb">Total Cost</div>
        <div class="vl"><span class="hl">$</span>${esc(costValue(stats.totalCost))}</div>
      </div>
      <div class="sc">
        <div class="lb">Active Days</div>
        <div class="vl">${stats.activeDays}</div>
      </div>
      <div class="sc">
        <div class="lb">Models Used</div>
        <div class="vl">${stats.topModels.length}</div>
      </div>
    </div>
    <div class="rule" style="width:100%"></div>
    <div class="info" style="text-align:center">${esc(formatDate(since))} &mdash; ${esc(formatDate(until))}, ${esc(year)}</div>
    <div style="margin-top:12px">${stamp}</div>
    <div style="font-family:'Space Mono',monospace;font-size:9px;color:var(--muted2);letter-spacing:0.1em;margin-top:8px">GENERATED ${esc(generatedAt)}</div>
  </div>
</div>`;

  // ── Full HTML ──

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI Wrapped \u2014 TokenLeak</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,300;12..96,400;12..96,500;12..96,600;12..96,700;12..96,800&family=Space+Grotesk:wght@300;400;500;600;700&family=Space+Mono:ital,wght@0,400;0,700;1,400;1,700&display=swap" rel="stylesheet">
<style>
:root {
  --bg: #09090b;
  --surface: #111114;
  --surface2: #16161a;
  --border: rgba(255,255,255,0.07);
  --border-hi: rgba(212,175,95,0.24);
  --gold: #d4af5f;
  --gold-dim: #a08040;
  --gold-pale: rgba(212,175,95,0.1);
  --ivory: #f0ead6;
  --ivory-dim: rgba(240,234,214,0.52);
  --text: #e8e2cc;
  --muted: rgba(232,226,204,0.38);
  --muted2: rgba(232,226,204,0.18);
}
* { margin:0; padding:0; box-sizing:border-box; }
html, body { width:100%; height:100%; background:var(--bg); font-family:'Space Grotesk',sans-serif; color:var(--text); overflow:hidden; }

/* Background layers */
.bg-layer { position:fixed; inset:0; z-index:0; background: radial-gradient(ellipse 60% 50% at 10% 10%, rgba(44,70,120,0.07) 0%, transparent 60%), radial-gradient(ellipse 50% 50% at 90% 90%, rgba(155,60,75,0.06) 0%, transparent 60%); }
.noise { position:fixed; inset:0; z-index:0; opacity:0.06; pointer-events:none; background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.78' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); background-size:180px; }

/* Stage */
#stage { position:fixed; inset:0; z-index:10; display:flex; align-items:center; justify-content:center; }

/* Slide card */
.slide { position:absolute; width:min(614px,95vw); min-height:min(838px,92vh); max-height:94vh; overflow-y:auto; scrollbar-width:none; background:var(--surface); border:1px solid var(--border); border-radius:3px; padding:58px 52px 48px; display:flex; flex-direction:column; opacity:0; transform:translateY(32px) scale(0.988); transition:opacity 0.6s cubic-bezier(.22,1,.36,1), transform 0.6s cubic-bezier(.22,1,.36,1); pointer-events:none; box-shadow:0 1px 0 rgba(212,175,95,0.18) inset, 0 0 0 1px rgba(0,0,0,0.6), 0 40px 80px rgba(0,0,0,0.75); }
.slide::-webkit-scrollbar { display:none; }
.slide.active { opacity:1; transform:translateY(0) scale(1); pointer-events:all; }
.slide.exit-up { opacity:0; transform:translateY(-32px) scale(0.988); transition:opacity 0.36s ease, transform 0.36s ease; }
.slide::before { content:''; position:absolute; top:0; left:0; right:0; height:1px; background:var(--gold); opacity:0.5; border-radius:3px 3px 0 0; }

/* Typography */
.slide-tag { font-family:'Space Mono',monospace; font-size:12px; letter-spacing:0.22em; color:var(--muted); text-transform:uppercase; margin-bottom:36px; }
.slide-tag em { font-style:normal; color:var(--gold); }
h1.hero { font-family:'Bricolage Grotesque',sans-serif; font-size:clamp(58px,12vw,88px); font-weight:800; line-height:0.91; letter-spacing:-0.045em; color:var(--ivory); }
h2.title { font-family:'Bricolage Grotesque',sans-serif; font-size:clamp(31px,6.5vw,46px); font-weight:700; line-height:1.06; letter-spacing:-0.03em; color:var(--ivory); margin-bottom:32px; }
.hl { color:var(--gold); }
.rule { height:1px; background:var(--border); margin:28px 0; }
.rule-hi { height:1px; background:var(--border-hi); margin:22px 0; }

/* Stat card */
.sc { background:var(--surface2); border:1px solid var(--border); border-radius:2px; padding:22px 24px; display:flex; flex-direction:column; gap:5px; }
.lb { font-family:'Space Mono',monospace; font-size:11px; letter-spacing:0.18em; color:var(--muted); text-transform:uppercase; }
.vl { font-family:'Bricolage Grotesque',sans-serif; font-size:clamp(30px,6.5vw,46px); font-weight:800; color:var(--ivory); line-height:1; letter-spacing:-0.035em; }
.un { font-family:'Space Mono',monospace; font-size:11px; color:var(--gold); letter-spacing:0.12em; text-transform:uppercase; }
.g2 { display:grid; grid-template-columns:1fr 1fr; gap:11px; }

/* Bars */
.bar { display:flex; flex-direction:column; gap:9px; margin-bottom:20px; }
.bar:last-child { margin-bottom:0; }
.bar-top { display:flex; justify-content:space-between; align-items:baseline; }
.bar-name { font-size:16px; font-weight:500; color:var(--text); }
.bar-sub { font-size:12px; color:var(--muted); margin-top:1px; }
.bar-pct { font-family:'Space Mono',monospace; font-size:13px; color:var(--gold); }
.bar-track { height:1px; background:rgba(255,255,255,0.09); }
.bar-fill { height:100%; background:var(--gold); transition:width 1.1s cubic-bezier(.4,0,.2,1); }

/* Streak dots */
.sdots { display:flex; flex-wrap:wrap; gap:5px; margin:16px 0; }
.sd { width:11px; height:11px; border-radius:2px; background:var(--surface2); border:1px solid rgba(255,255,255,0.07); }
.sd.hit { background:var(--gold-dim); border-color:var(--gold-dim); }
.sd.now { background:var(--gold); border-color:var(--gold); }

/* Day of week */
.dow-row { display:grid; grid-template-columns:repeat(7,1fr); gap:6px; margin-top:16px; }
.dow-col { display:flex; flex-direction:column; align-items:center; gap:6px; }
.dow-bg { width:100%; display:flex; align-items:flex-end; justify-content:center; height:86px; }
.dow-b { width:100%; background:var(--gold); min-height:3px; border-radius:1px 1px 0 0; }
.dow-l { font-family:'Space Mono',monospace; font-size:9px; color:var(--muted); text-transform:uppercase; letter-spacing:0.06em; }

/* Time of day */
.tod-grid { display:grid; grid-template-columns:1fr 1fr; gap:9px; margin-top:8px; }
.tod-cell { background:var(--surface2); border:1px solid var(--border); border-radius:2px; padding:18px 16px; display:flex; flex-direction:column; gap:5px; }
.tod-cell.hi { border-color:var(--border-hi); }
.tod-ico { font-size:22px; line-height:1; }
.tod-nm { font-family:'Space Mono',monospace; font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:0.12em; }
.tod-val { font-family:'Bricolage Grotesque',sans-serif; font-size:26px; font-weight:800; letter-spacing:-0.025em; color:var(--ivory); }
.tod-sub { font-size:12px; color:var(--muted); }

/* Cache ring */
.ring-wrap { position:relative; display:flex; align-items:center; justify-content:center; margin:10px 0 16px; }
.ring-center { position:absolute; text-align:center; top:50%; left:50%; transform:translate(-50%,-50%); }
.ring-pct { font-family:'Bricolage Grotesque',sans-serif; font-size:40px; font-weight:800; color:var(--gold); letter-spacing:-0.04em; line-height:1; }
.ring-lb { font-family:'Space Mono',monospace; font-size:10px; color:var(--muted); letter-spacing:0.14em; margin-top:3px; }

/* Peak box */
.peak-box { border:1px solid var(--border-hi); background:var(--surface2); border-radius:2px; padding:32px 28px; text-align:center; margin-top:8px; }
.peak-dt { font-family:'Space Mono',monospace; font-size:12px; color:var(--muted); letter-spacing:0.2em; margin-bottom:14px; text-transform:uppercase; }
.peak-num { font-family:'Bricolage Grotesque',sans-serif; font-size:70px; font-weight:800; color:var(--gold); line-height:1; letter-spacing:-0.04em; }
.peak-lb { font-family:'Space Mono',monospace; font-size:10.5px; color:var(--muted); letter-spacing:0.16em; margin-top:10px; text-transform:uppercase; }

/* Projection */
.proj-fig { font-family:'Bricolage Grotesque',sans-serif; font-size:82px; font-weight:800; line-height:1; letter-spacing:-0.045em; color:var(--ivory); }
.proj-fig .c { color:var(--gold); }

/* Badges */
.badges { display:flex; flex-wrap:wrap; gap:9px; }
.badge { display:flex; align-items:center; gap:9px; background:var(--surface2); border:1px solid var(--border); border-radius:2px; padding:10px 15px; }
.badge.on { border-color:var(--border-hi); }
.badge.off { opacity:0.25; filter:grayscale(1); }
.ico { font-size:18px; }
.b-name { font-size:13px; font-weight:600; color:var(--ivory); }
.b-sub { font-family:'Space Mono',monospace; font-size:10px; color:var(--muted); margin-top:1px; }

/* Info text */
.info { font-size:14px; color:var(--muted); line-height:1.6; }
.info .hi { color:var(--gold); }

/* Stamp */
.stamp { display:inline-flex; align-items:center; gap:12px; border:1px solid var(--border-hi); border-radius:2px; padding:8px 16px; }
.stamp-name { font-family:'Bricolage Grotesque',sans-serif; font-weight:800; font-size:16px; color:var(--gold); letter-spacing:-0.025em; }
.stamp-sep { width:1px; height:16px; background:var(--border-hi); }
.stamp-tag { font-family:'Space Mono',monospace; font-size:10px; color:var(--muted); letter-spacing:0.12em; text-transform:uppercase; }

/* Nav */
#nav { position:fixed; bottom:28px; left:50%; transform:translateX(-50%); z-index:100; display:flex; align-items:center; gap:16px; }
#nav button { width:38px; height:38px; border-radius:2px; background:var(--surface2); border:1px solid var(--border); color:var(--muted); font-size:15px; cursor:pointer; transition:border-color .2s, color .2s; display:flex; align-items:center; justify-content:center; }
#nav button:hover:not(:disabled) { border-color:var(--gold); color:var(--gold); }
#nav button:disabled { opacity:.18; cursor:not-allowed; }
.ctr { font-family:'Space Mono',monospace; font-size:11px; color:var(--muted); letter-spacing:0.14em; }

/* Progress dots */
#dots { position:fixed; top:24px; left:50%; transform:translateX(-50%); z-index:100; display:flex; gap:6px; align-items:center; }
.dot { width:5px; height:5px; border-radius:50%; background:rgba(255,255,255,0.1); transition:all .3s ease; cursor:pointer; }
.dot.active { background:var(--gold); width:16px; border-radius:1px; }

/* Title slide */
.eyebrow { font-family:'Space Mono',monospace; font-size:12px; letter-spacing:0.22em; color:var(--muted); text-transform:uppercase; margin-bottom:22px; }
.dt-range { font-family:'Space Mono',monospace; font-size:14px; color:var(--muted); margin-top:24px; }
.dt-range em { font-style:normal; color:var(--gold); }
@keyframes pulse { 0%,100%{opacity:1;} 50%{opacity:0.25;} }
.pulse { display:inline-block; width:6px; height:6px; border-radius:50%; background:var(--gold); animation:pulse 2.6s ease infinite; vertical-align:middle; margin-right:8px; }

/* Footer layout */
.foot-body { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px; text-align:center; }
</style>
</head>
<body>
<div class="bg-layer"></div>
<div class="noise"></div>
<div id="dots"></div>
<div id="stage">
  ${slide01}
  ${slide02}
  ${slide03}
  ${slide04}
  ${slide05}
  ${slide06}
  ${slide07}
  ${slide08}
  ${slide09}
  ${slide10}
  ${slide11}
  ${slide12}
</div>
<div id="nav">
  <button id="btnPrev" disabled>&#x2190;</button>
  <span class="ctr" id="counter">01 / 12</span>
  <button id="btnNext">&#x2192;</button>
</div>
<script>
(function(){
  var slides = document.querySelectorAll('.slide');
  var dotsEl = document.getElementById('dots');
  var cur = 0;

  for (var i = 0; i < slides.length; i++) {
    var d = document.createElement('div');
    d.className = 'dot' + (i === 0 ? ' active' : '');
    d.setAttribute('data-idx', String(i));
    d.onclick = function() { goTo(parseInt(this.getAttribute('data-idx'), 10)); };
    dotsEl.appendChild(d);
  }

  // Streak dots
  var sc = document.getElementById('streakDots');
  var currentStreak = parseInt(sc ? sc.dataset.currentStreak || '0' : '0', 10);
  if (sc) {
    for (var i = 0; i < 60; i++) {
      var d = document.createElement('div');
      if (i >= 60 - currentStreak) d.className = 'sd now';
      else if (i >= 14 && Math.random() > 0.28) d.className = 'sd hit';
      else d.className = 'sd';
      sc.appendChild(d);
    }
  }

  // Day of week bars
  var dg = document.getElementById('dowGrid');
  var dowData = [];
  try { dowData = JSON.parse(dg ? dg.dataset.dow || '[]' : '[]'); } catch(e) {}
  if (dg) {
    for (var i = 0; i < dowData.length; i++) {
      var col = document.createElement('div');
      col.className = 'dow-col';
      var p = dowData[i].p;
      var opacity = p < 35 ? '0.35' : p < 55 ? '0.6' : '1';
      col.innerHTML = '<div class="dow-bg"><div class="dow-b" style="height:' + (p * 0.84) + 'px;opacity:' + opacity + ';"></div></div><div class="dow-l">' + dowData[i].d + '</div>';
      dg.appendChild(col);
    }
  }

  function goTo(n) {
    if (n < 0 || n >= slides.length) return;
    slides[cur].classList.remove('active');
    slides[cur].classList.add('exit-up');
    var prev = cur;
    setTimeout(function() { slides[prev].classList.remove('exit-up'); }, 380);
    cur = n;
    slides[cur].classList.add('active');
    document.getElementById('counter').textContent = String(cur + 1).padStart(2, '0') + ' / ' + String(slides.length).padStart(2, '0');
    document.getElementById('btnPrev').disabled = cur === 0;
    document.getElementById('btnNext').disabled = cur === slides.length - 1;
    var dots = document.querySelectorAll('#dots .dot');
    for (var i = 0; i < dots.length; i++) {
      if (i === cur) dots[i].classList.add('active');
      else dots[i].classList.remove('active');
    }
  }

  document.getElementById('btnNext').onclick = function() { goTo(cur + 1); };
  document.getElementById('btnPrev').onclick = function() { goTo(cur - 1); };
  document.addEventListener('keydown', function(e) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') goTo(cur + 1);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') goTo(cur - 1);
  });
  var tx = null;
  document.addEventListener('touchstart', function(e) { tx = e.touches[0].clientX; });
  document.addEventListener('touchend', function(e) {
    if (tx === null) return;
    var dx = tx - e.changedTouches[0].clientX;
    if (Math.abs(dx) > 44) { dx > 0 ? goTo(cur + 1) : goTo(cur - 1); }
    tx = null;
  });
})();
</script>
</body>
</html>`;
}
