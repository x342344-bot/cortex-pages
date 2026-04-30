/* ═══════════ CORTEX DASHBOARD JS v1 ═══════════ */
/* Shared utilities for dashboard pages (sector, asset).
   Loaded before inline <script> which defines D = __PAGE_DATA__.
   Functions referencing D are called from inline scripts (not at load time). */

/* --- DOM helper --- */
const $ = id => document.getElementById(id);

/* --- HTML escape --- */
function e(s) {
  const d = document.createElement('div');
  d.textContent = s != null ? String(s) : '';
  return d.innerHTML;
}

/* --- Markdown-lite: **bold**, `code`, [link](url) --- */
function md(s) {
  let h = e(s);
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong style="color:#fff;font-weight:600">$1</strong>');
  h = h.replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.08);padding:1px 5px;border-radius:3px;font-size:0.92em">$1</code>');
  h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return h;
}

/* --- Status Chinese mapping --- */
const STATUS_CN = {
  confirmed: '已验证',
  strong: '趋势向好',
  approaching: '接近触发',
  watching: '观察中',
  weakening: '转弱',
  failing: '已失败'
};
function statusCn(s) { return STATUS_CN[(s || '').toLowerCase()] || s || '—'; }

/* --- Tipping point state inference --- */
function ipState(ip) {
  if (ip.score_status) {
    const s = String(ip.score_status).toLowerCase();
    if (['confirmed','strong','approaching','watching','weakening','failing'].includes(s)) return s;
  }
  if (ip.status) {
    const s = String(ip.status).toLowerCase();
    if (s.includes('trigger') || s.includes('confirmed')) return 'confirmed';
    if (s.includes('fail') || s.includes('negative')) return 'failing';
    if (s.includes('approach') || s.includes('partial')) return 'approaching';
    if (s.includes('strong')) return 'strong';
    if (s.includes('weak')) return 'weakening';
  }
  return 'watching';
}

/* --- Tab switching --- */
function showTab(id, btn) {
  document.querySelectorAll('.page-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  const el = $(id);
  if (el) el.classList.add('active');
  if (btn) btn.classList.add('active');
}

/* --- Newline → <br> --- */
function nl2br(s) { return (s != null ? String(s) : '').replace(/\n/g, '<br>'); }

/* --- Rich text block renderer: \n → <p>, - → <li> --- */
function renderBlock(s) {
  if (s == null || s === '') return '';
  const lines = String(s).split('\n');
  let out = '';
  let inList = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) { if (inList) { out += '</ul>'; inList = false; } continue; }
    if (line.match(/^[-•]\s/)) {
      if (!inList) { out += '<ul style="margin:4px 0;padding-left:18px;line-height:1.7">'; inList = true; }
      out += '<li style="margin:2px 0">' + md(line.replace(/^[-•]\s*/, '')) + '</li>';
    } else {
      if (inList) { out += '</ul>'; inList = false; }
      out += '<p style="margin:4px 0;line-height:1.7">' + md(line) + '</p>';
    }
  }
  if (inList) out += '</ul>';
  return out;
}

/* --- Semicolon/Chinese-semicolon → bullet list --- */
function renderList(s) {
  if (s == null || s === '') return '';
  const items = String(s).split(/[;；]/).map(x => x.trim()).filter(Boolean);
  if (items.length <= 1) return '<div style="line-height:1.7">' + md(s) + '</div>';
  let out = '<ul style="margin:0;padding-left:16px;line-height:1.8">';
  for (let i = 0; i < items.length; i++) {
    out += '<li style="margin:2px 0;color:var(--text-2)">' + md(items[i]) + '</li>';
  }
  return out + '</ul>';
}

/* --- Normalize hypotheses (merged sector + asset logic) --- */
function normalizeHypotheses() {
  if ((D.hypotheses || []).length) {
    return D.hypotheses.map((h, idx) => ({
      id: h.id || `H${idx + 1}`,
      title: h.title || h.id || `Hypothesis ${idx + 1}`,
      layer: h.layer || 'river',
      statement: h.statement || '',
      why: h.why || '',
      status: h.status || 'open',
      confidence: h.confidence != null ? h.confidence : '',
      tipping_points: h.tipping_points || [],
    }));
  }
  // Legacy fallback: asset pages with sector_hypothesis field
  if (D.sector_hypothesis) {
    return [{
      id: 'H1',
      title: 'Legacy Hypothesis',
      layer: 'river',
      statement: D.sector_hypothesis,
      why: '',
      status: 'open',
      tipping_points: (D.inflection_points || []).filter(ip =>
        (ip.linked_hypothesis || '') !== 'asset_judgment'),
    }];
  }
  return [];
}
