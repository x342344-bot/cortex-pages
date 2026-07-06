/* ===== Sentinel Sankey · 河流图 + Tooltip + Drawer =====
 * Spec: 5-ability/portal/INTERACTION-SPEC.md
 *
 * 公开入口：window.renderSentinel(data, hostSelector)
 *   data: load_sentinel_for_sector() 输出的 view model
 *   hostSelector: 容器选择器（如 '#sentinel-host'）
 */
(function () {
  'use strict';

  // ===== Helpers =====
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  // Estimate character width for proportional fonts (Inter, etc.)
  // CJK ideographs ≈ 1.0 × fontSize, Latin/digits ≈ 0.55 × fontSize
  function estCharWidth(ch, fontSize) {
    var code = ch.charCodeAt(0);
    if (code >= 0x4E00 && code <= 0x9FFF) return fontSize * 1.0;       // CJK
    if (code >= 0x3000 && code <= 0x303F) return fontSize * 1.0;       // CJK punct
    if (code >= 0xFF00 && code <= 0xFFEF) return fontSize * 1.0;       // Fullwidth
    if (ch === '⚡' || ch === '↑' || ch === '↓' || ch === '▲') return fontSize * 1.0;
    return fontSize * 0.55;                                             // Latin / digits / spaces
  }
  function truncateForWidth(text, maxWidth, fontSize) {
    if (!text) return '';
    var s = String(text);
    var ellipsisW = fontSize * 0.55;
    var w = 0;
    for (var i = 0; i < s.length; i++) {
      w += estCharWidth(s[i], fontSize);
      if (w > maxWidth) {
        // Need ellipsis — back off until ellipsisW fits
        while (i > 0 && w + ellipsisW > maxWidth) {
          w -= estCharWidth(s[i], fontSize);
          i--;
        }
        return s.slice(0, i) + '…';
      }
    }
    return s;
  }
  // Mono-font variant: ~0.6 × fontSize per char, CJK still 1.0
  function truncateForWidthMono(text, maxWidth, fontSize) {
    if (!text) return '';
    var s = String(text);
    var ellipsisW = fontSize * 0.6;
    var w = 0;
    for (var i = 0; i < s.length; i++) {
      var code = s.charCodeAt(i);
      var cw = (code >= 0x4E00 && code <= 0x9FFF) ? fontSize * 1.0 : fontSize * 0.6;
      w += cw;
      if (w > maxWidth) {
        while (i > 0 && w + ellipsisW > maxWidth) {
          var c0 = s.charCodeAt(i);
          var cw0 = (c0 >= 0x4E00 && c0 <= 0x9FFF) ? fontSize * 1.0 : fontSize * 0.6;
          w -= cw0;
          i--;
        }
        return s.slice(0, i) + '…';
      }
    }
    return s;
  }

  // 状态色映射 (state for hypothesis, status for TP)
  function stateColor(s) {
    var k = (s || '').toLowerCase();
    if (k === 'active' || k === 'confirmed') return { fg: '#16a34a', bg: 'rgba(93,203,142,0.10)' };
    if (k === 'open') return { fg: '#94a3b8', bg: 'rgba(166,181,172,0.08)' };
    if (k === 'watch' || k === 'watching') return { fg: '#EAB308', bg: 'rgba(201,154,0,0.10)' };
    if (k === 'approaching') return { fg: '#F97316', bg: 'rgba(249,123,61,0.12)' };
    if (k === 'strong') return { fg: '#16a34a', bg: 'rgba(93,203,142,0.10)' };
    if (k === 'challenged' || k === 'mixed') return { fg: '#F97316', bg: 'rgba(249,123,61,0.10)' };
    if (k === 'falsified' || k === 'failed') return { fg: '#dc2626', bg: 'rgba(248,113,113,0.10)' };
    return { fg: '#94a3b8', bg: 'rgba(166,181,172,0.06)' };
  }

  function classificationCN(c) {
    var k = (c || '').trim();
    if (k === '涨落') return { label: '涨落', cls: 'up' };
    if (k === '改道') return { label: '改道', cls: 'shift' };
    if (k === '浪花') return { label: '浪花', cls: 'shift' };
    if (k === '暗流') return { label: '暗流', cls: 'under' };
    if (k === '溃堤') return { label: '溃堤', cls: 'shift' };
    return { label: k || '—', cls: 'up' };
  }

  function tpStatusCN(s) {
    var k = (s || '').toLowerCase();
    if (k === 'watching') return '观察';
    if (k === 'approaching') return '接近';
    if (k === 'strong') return '趋强';
    if (k === 'open') return '待证';
    if (k === 'failed') return '失败';
    return s || '—';
  }

  function stateCN(s) {
    var k = (s || '').toLowerCase();
    if (k === 'active') return '活跃';
    if (k === 'open') return '待证';
    if (k === 'watch' || k === 'watching') return '监察';
    if (k === 'challenged') return '存疑';
    if (k === 'mixed') return '存疑';
    if (k === 'falsified') return '证伪';
    if (k === 'resolved') return '已决';
    return s || '—';
  }

  // 子假设数: hypotheses 中 parent_ids 包含 nodeId
  function findChildren(data, nodeId) {
    var all = [].concat(
      (data.river_layers && data.river_layers.river) || [],
      (data.river_layers && data.river_layers.branch) || [],
      data.asset_hypotheses || []
    );
    return all.filter(function (h) {
      return (h.parent_ids || []).indexOf(nodeId) >= 0;
    });
  }
  function findParents(data, hyp) {
    if (!hyp || !hyp.parent_ids) return [];
    var allById = {};
    var collect = function (arr) { (arr || []).forEach(function (h) { allById[h.id] = h; }); };
    collect((data.river_layers || {}).riverbank);
    collect((data.river_layers || {}).river);
    collect((data.river_layers || {}).branch);
    collect(data.asset_hypotheses);
    return hyp.parent_ids.map(function (pid) { return allById[pid]; }).filter(Boolean);
  }
  function findRelatedTPs(data, hypId) {
    return (data.tipping_points || []).filter(function (tp) { return tp.hypothesis_id === hypId; });
  }
  function findRelatedSignals(data, hypId) {
    return (data.signals || []).filter(function (sg) { return sg.hypothesis_id === hypId; });
  }
  function findNode(data, nodeId) {
    var pools = [
      { type: 'riverbank', arr: (data.river_layers || {}).riverbank },
      { type: 'river', arr: (data.river_layers || {}).river },
      { type: 'branch', arr: (data.river_layers || {}).branch },
      { type: 'asset', arr: data.asset_hypotheses }
    ];
    for (var i = 0; i < pools.length; i++) {
      var arr = pools[i].arr || [];
      for (var j = 0; j < arr.length; j++) {
        if (arr[j].id === nodeId) return { type: pools[i].type, node: arr[j] };
      }
    }
    return null;
  }

  // ===== Layout (基于层级 + index 的简单布局) =====
  function computeLayout(data) {
    var rb = ((data.river_layers || {}).riverbank || []).slice();
    var rv = ((data.river_layers || {}).river || []).slice();
    var br = ((data.river_layers || {}).branch || []).slice();
    var as = (data.asset_hypotheses || []).slice();

    // Canvas size
    var W = 1440;
    var topMargin = 60;
    var bottomMargin = 60;

    // 按层估算需要的高度（每个节点 + gap）
    var rivH = 100, rivGap = 15;
    var rbH = 92, rbGap = 130;
    var brH = 80, brGap = 80;
    var asH = 56, asGap = 14;

    // 河流层决定 SVG 总高（最多节点数）
    var riverBlockH = rv.length ? rv.length * (rivH + rivGap) - rivGap : 0;
    var assetBlockH = as.length ? as.length * (asH + asGap) - asGap : 0;
    var H = Math.max(
      topMargin + bottomMargin + riverBlockH,
      topMargin + bottomMargin + assetBlockH,
      900
    );

    // Column x positions
    var colX = { rb: 80, river: 470, branch: 890, asset: 1140 };
    var colW = { rb: 200, river: 180, branch: 200, asset: 220 };

    // RB y positions: 均匀分布
    var rbCount = rb.length || 1;
    var rbAvailH = H - topMargin - bottomMargin;
    var rbStep = rbCount > 1 ? rbAvailH / (rbCount - 1) : 0;
    var rbPositions = rb.map(function (n, i) {
      var y = rbCount === 1 ? topMargin + rbAvailH / 2 - rbH / 2
                            : topMargin + i * rbStep - (rbCount > 1 ? rbH / 2 * (i / (rbCount - 1)) : 0);
      // 简单平均分布
      y = topMargin + (rbCount > 1 ? i * rbStep - (rbStep > rbH ? 0 : 0) : (rbAvailH - rbH) / 2);
      return { id: n.id, x: colX.rb, y: Math.max(topMargin, y), w: colW.rb, h: rbH, node: n };
    });
    // 重新均匀分布 RB
    if (rbCount > 1) {
      var rbStart = topMargin;
      var rbEnd = H - bottomMargin - rbH;
      var rbStep2 = (rbEnd - rbStart) / (rbCount - 1);
      rbPositions = rb.map(function (n, i) {
        return { id: n.id, x: colX.rb, y: Math.round(rbStart + i * rbStep2), w: colW.rb, h: rbH, node: n };
      });
    }

    // River y positions: 均匀分布
    var rvStart = topMargin;
    var rvPositions = rv.map(function (n, i) {
      // signal-active node 高度更高
      var hasSignal = (data.signals || []).some(function (sg) { return sg.hypothesis_id === n.id && (sg.date || '') >= today() ; });
      var nodeH = hasSignal ? 110 : 100;
      var y = rvStart + i * (rivH + rivGap);
      return { id: n.id, x: colX.river, y: y, w: colW.river, h: nodeH, node: n, hasSignal: hasSignal };
    });

    // Branch y positions: 围绕父 H 节点放
    var brPositions = br.map(function (n, i) {
      // 找 parent H
      var parentRiver = rvPositions.find(function (r) { return n.parent_ids && n.parent_ids.indexOf(r.id) >= 0; });
      var y = parentRiver ? parentRiver.y + parentRiver.h / 2 - brH / 2 : topMargin + i * (brH + brGap);
      return { id: n.id, x: colX.branch, y: y, w: colW.branch, h: brH, node: n };
    });

    // Asset y positions: 均匀分布
    var asStart = topMargin + 5;
    var asPositions = as.map(function (n, i) {
      return { id: n.id, x: colX.asset, y: asStart + i * (asH + asGap), w: colW.asset, h: asH, node: n };
    });

    // 重算 H：所有列里最低节点 y + h
    var maxY = 0;
    [rbPositions, rvPositions, brPositions, asPositions].forEach(function (col) {
      col.forEach(function (p) { maxY = Math.max(maxY, p.y + p.h); });
    });
    H = Math.max(H, maxY + bottomMargin);

    return {
      W: W,
      H: H,
      colX: colX,
      colW: colW,
      rb: rbPositions,
      river: rvPositions,
      branch: brPositions,
      asset: asPositions
    };
  }

  // 当日定义：取 signals 里最近一条的日期当作"今天"（mockup 用 5/5）
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function latestDate(signals) {
    if (!signals || !signals.length) return today();
    return signals[0].date || today();
  }
  function isLatestSignal(sg, latestD) { return sg.date === latestD; }

  // ===== SVG 渲染 =====
  function renderFlows(layout, data, latestD) {
    var s = '';

    // RB → River 连线 (基于 parent_ids)
    layout.river.forEach(function (rv) {
      (rv.node.parent_ids || []).forEach(function (pid, idx) {
        var p = layout.rb.find(function (x) { return x.id === pid; });
        if (!p) return;
        var x1 = p.x + p.w, y1 = p.y + p.h / 2;
        var x2 = rv.x, y2 = rv.y + rv.h / 2;
        var mx = (x1 + x2) / 2;
        s += '<path d="M ' + x1 + ' ' + y1 + ' C ' + mx + ' ' + y1 + ', ' + mx + ' ' + y2 + ', ' + x2 + ' ' + y2 +
             '" stroke="#1e3a8a" stroke-width="' + (10 + Math.random() * 4) + '" fill="none" opacity="0.28"/>';
      });
    });

    // River → River cross (parent_ids 中包含其他 H/F)
    layout.river.forEach(function (rv) {
      (rv.node.parent_ids || []).forEach(function (pid) {
        var pr = layout.river.find(function (x) { return x.id === pid; });
        var pb = layout.branch.find(function (x) { return x.id === pid; });
        var p = pr || pb;
        if (!p || p.id === rv.id) return;
        var x1 = p.x + p.w / 2, y1 = p.y + p.h;
        var x2 = rv.x, y2 = rv.y + rv.h / 2;
        s += '<path d="M ' + x1 + ' ' + y1 + ' C ' + x1 + ' ' + (y1 + 50) + ', ' + x2 + ' ' + (y2 - 50) + ', ' + x2 + ' ' + y2 +
             '" stroke="#2563eb" stroke-width="5" fill="none" opacity="0.30" stroke-dasharray="3,3"/>';
      });
    });

    // River → Branch (基于 branch.parent_ids)
    layout.branch.forEach(function (br) {
      (br.node.parent_ids || []).forEach(function (pid) {
        var p = layout.river.find(function (x) { return x.id === pid; });
        if (!p) return;
        var x1 = p.x + p.w, y1 = p.y + p.h / 2;
        var x2 = br.x, y2 = br.y + br.h / 2;
        var mx = (x1 + x2) / 2;
        // 检查父节点是否有当日信号 → 金色虚线
        var hasSig = (data.signals || []).some(function (sg) { return sg.hypothesis_id === p.id && isLatestSignal(sg, latestD); });
        if (hasSig) {
          s += '<path d="M ' + x1 + ' ' + y1 + ' C ' + mx + ' ' + y1 + ', ' + mx + ' ' + y2 + ', ' + x2 + ' ' + y2 +
               '" stroke="#FBBF24" stroke-width="9" fill="none" opacity="0.85" stroke-dasharray="8 8"><animate attributeName="stroke-dashoffset" from="0" to="-30" dur="1.8s" repeatCount="indefinite"/></path>';
        } else {
          s += '<path d="M ' + x1 + ' ' + y1 + ' C ' + mx + ' ' + y1 + ', ' + mx + ' ' + y2 + ', ' + x2 + ' ' + y2 +
               '" stroke="#2563eb" stroke-width="8" fill="none" opacity="0.30"/>';
        }
      });
    });

    // River → Asset (asset.parent_ids 含 H/RB)
    layout.asset.forEach(function (as) {
      (as.node.parent_ids || []).forEach(function (pid) {
        var p = layout.river.find(function (x) { return x.id === pid; });
        if (!p) return;
        var x1 = p.x + p.w, y1 = p.y + p.h / 2;
        var x2 = as.x, y2 = as.y + as.h / 2;
        var mx = (x1 + x2) / 2;
        // asset 自己当日有信号 → 金色虚线
        var hasSig = (data.signals || []).some(function (sg) { return sg.hypothesis_id === as.id && isLatestSignal(sg, latestD); });
        if (hasSig) {
          s += '<path d="M ' + x1 + ' ' + y1 + ' C ' + mx + ' ' + y1 + ', ' + mx + ' ' + y2 + ', ' + x2 + ' ' + y2 +
               '" stroke="#FBBF24" stroke-width="6" fill="none" opacity="0.85" stroke-dasharray="8 8"><animate attributeName="stroke-dashoffset" from="0" to="-30" dur="1.8s" repeatCount="indefinite"/></path>';
        } else {
          s += '<path d="M ' + x1 + ' ' + y1 + ' C ' + mx + ' ' + y1 + ', ' + mx + ' ' + y2 + ', ' + x2 + ' ' + y2 +
               '" stroke="#0e7490" stroke-width="5" fill="none" opacity="0.18"/>';
        }
      });
    });

    return s;
  }

  // 河岸卡片
  function renderRBCard(p, data, latestD) {
    var n = p.node;
    var cnt = n.child_count !== undefined ? n.child_count : 0;
    var titleLines = wrapTitle(n.title || '', 8);
    // 方案 A: count downstream signals — 任何 child（river/asset）当日有 signal
    var children = findChildren(data, n.id);
    var todaySigCount = 0;
    children.forEach(function (c) {
      var sigs = findRelatedSignals(data, c.id);
      if (sigs.some(function (sg) { return isLatestSignal(sg, latestD); })) todaySigCount++;
    });
    var hasDownstream = todaySigCount > 0;

    var s = '<g class="snt-node" data-node-id="' + esc(n.id) + '" data-node-type="riverbank">';
    if (hasDownstream) {
      s += '<rect x="' + (p.x - 4) + '" y="' + (p.y - 4) + '" width="' + (p.w + 8) + '" height="' + (p.h + 8) + '" rx="12" fill="none" stroke="#FBBF24" stroke-width="0.5" opacity="0.4"/>';
    }
    s += '<rect x="' + p.x + '" y="' + p.y + '" width="' + p.w + '" height="' + p.h + '" rx="10" fill="url(#snt-rbG)"/>';
    s += '<rect x="' + p.x + '" y="' + p.y + '" width="' + p.w + '" height="' + p.h + '" rx="10" fill="none" stroke="' + (hasDownstream ? '#FBBF24' : '#c7d2fe') + '" stroke-width="' + (hasDownstream ? '1.5' : '0.5') + '" opacity="' + (hasDownstream ? '0.7' : '0.5') + '"/>';
    s += '<text x="' + (p.x + 14) + '" y="' + (p.y + 23) + '" font-family="JetBrains Mono" font-size="11" font-weight="700" fill="#0f172a" letter-spacing="0.06em">' + esc(n.id) + '</text>';
    s += '<text x="' + (p.x + p.w - 14) + '" y="' + (p.y + 23) + '" font-family="JetBrains Mono" font-size="20" font-weight="700" fill="#0f172a" text-anchor="end">' + (n.confidence || 0) + '</text>';
    var ty = p.y + 48;
    titleLines.forEach(function (line, i) {
      s += '<text x="' + (p.x + 14) + '" y="' + (ty + i * 17) + '" font-family="Inter" font-size="14" font-weight="600" fill="#0f172a">' + esc(line) + '</text>';
    });
    var metaText = cnt + ' 子假设 · ' + stateCN(n.state);
    s += '<text x="' + (p.x + 14) + '" y="' + (p.y + p.h - 8) + '" font-family="JetBrains Mono" font-size="10" fill="rgba(15,23,42,0.7)">' + esc(metaText) + '</text>';
    // Downstream signal badge — right side under conf number (avoids meta overlap)
    if (hasDownstream) {
      var badgeText = '⚡ ' + todaySigCount + ' 下游';
      var bw = todaySigCount >= 10 ? 68 : 60;
      var bx = p.x + p.w - 14 - bw;
      s += '<rect x="' + bx + '" y="' + (p.y + 30) + '" width="' + bw + '" height="14" rx="7" fill="rgba(251,191,36,0.30)" stroke="#FBBF24" stroke-width="1"/>';
      s += '<text x="' + (bx + bw / 2) + '" y="' + (p.y + 40) + '" font-family="JetBrains Mono" font-size="9" font-weight="700" fill="#FBBF24" text-anchor="middle">' + esc(badgeText) + '</text>';
    }
    s += '</g>';
    return s;
  }

  // 河流卡片（含 TP 进度条 + signal badge）
  function renderRiverCard(p, data, latestD) {
    var n = p.node;
    var tps = findRelatedTPs(data, n.id);
    var sigs = findRelatedSignals(data, n.id);
    var todaySig = sigs.filter(function (sg) { return isLatestSignal(sg, latestD); })[0];
    var hasSignal = !!todaySig;
    var statusCounts = { watching: 0, approaching: 0, strong: 0, open: 0 };
    tps.forEach(function (tp) {
      var k = (tp.status || 'watching').toLowerCase();
      if (statusCounts[k] !== undefined) statusCounts[k]++;
    });
    var tpSummary = tps.length + ' 个拐点';
    if (statusCounts.approaching) tpSummary += ' · ' + statusCounts.approaching + ' 接近 ▲';
    if (statusCounts.strong) tpSummary += ' · ' + statusCounts.strong + ' 趋强 ▲';

    var s = '<g class="snt-node" data-node-id="' + esc(n.id) + '" data-node-type="river">';
    if (hasSignal) {
      s += '<rect x="' + (p.x - 4) + '" y="' + (p.y - 4) + '" width="' + (p.w + 8) + '" height="' + (p.h + 8) + '" rx="11" fill="none" stroke="#FBBF24" stroke-width="0.5" opacity="0.4"/>';
      s += '<rect x="' + p.x + '" y="' + p.y + '" width="' + p.w + '" height="' + p.h + '" rx="8" fill="url(#snt-cardBgGold)" stroke="#FBBF24" stroke-width="2"/>';
      // Left-edge gold ribbon (consistent with asset cards)
      s += '<rect x="' + p.x + '" y="' + p.y + '" width="4" height="' + p.h + '" rx="2" fill="#FBBF24"/>';
    } else {
      s += '<rect x="' + p.x + '" y="' + p.y + '" width="' + p.w + '" height="' + p.h + '" rx="8" fill="url(#snt-cardBg)" stroke="#2563eb" stroke-width="1.5"/>';
    }
    s += '<text x="' + (p.x + (hasSignal ? 16 : 14)) + '" y="' + (p.y + 23) + '" font-family="JetBrains Mono" font-size="11" font-weight="700" fill="#2563eb" letter-spacing="0.05em">' + esc(n.id) + '</text>';
    s += '<text x="' + (p.x + p.w - 14) + '" y="' + (p.y + 23) + '" font-family="JetBrains Mono" font-size="18" font-weight="700" fill="#0f172a" text-anchor="end">' + (n.confidence || 0) + '</text>';

    // signal badge inside top right (when active)
    if (hasSignal) {
      var cls = classificationCN(todaySig.classification).label;
      var sign = parseFloat(todaySig.delta) >= 0 ? '+' : '';
      var badgeText = (todaySig.date || '').slice(5) + ' ' + sign + (todaySig.delta || '0') + ' ' + cls;
      // approx width: each CJK char ~12px, latin ~6.6px in JetBrains Mono 10px
      var approxW = 0;
      for (var bi = 0; bi < badgeText.length; bi++) {
        var bcc = badgeText.charCodeAt(bi);
        approxW += (bcc >= 0x4E00 && bcc <= 0x9FFF) ? 12 : 6.6;
      }
      var bw = Math.ceil(approxW) + 20;
      var bx = p.x + p.w - 14 - bw;
      // Badge container: amber-glass background
      s += '<rect x="' + bx + '" y="' + (p.y + 32) + '" width="' + bw + '" height="18" rx="9" fill="rgba(251,191,36,0.18)" stroke="#FBBF24" stroke-width="1"/>';
      s += '<circle cx="' + (bx + 9) + '" cy="' + (p.y + 41) + '" r="3" fill="#FBBF24"><animate attributeName="opacity" values="0.4;1;0.4" dur="2s" repeatCount="indefinite"/></circle>';
      s += '<text x="' + (bx + 17) + '" y="' + (p.y + 45) + '" font-family="JetBrains Mono" font-size="10" font-weight="700" fill="#FBBF24">' + esc(badgeText) + '</text>';
    }

    // title (truncate aggressively to avoid overflow on narrow node)
    var titleY = hasSignal ? p.y + 67 : p.y + 47;
    var titleStr = truncateForWidth(n.title || '', p.w - 28, 13);
    s += '<text x="' + (p.x + 14) + '" y="' + titleY + '" font-family="Inter" font-size="13" font-weight="500" fill="#0f172a">' + esc(titleStr) + '</text>';

    // TP summary
    var tpSummY = titleY + 17;
    s += '<text x="' + (p.x + 14) + '" y="' + tpSummY + '" font-family="JetBrains Mono" font-size="10" fill="' + (statusCounts.approaching ? '#F97316' : (statusCounts.strong ? '#16a34a' : '#94a3b8')) + '">' + esc(tpSummary) + '</text>';

    // TP bars (max 3 displayed)
    var barY = tpSummY + 10;
    var maxBars = Math.min(3, tps.length);
    var barW = (p.w - 28) / 3 - 4;
    for (var i = 0; i < maxBars; i++) {
      var tp = tps[i];
      var st = (tp.status || 'watching').toLowerCase();
      var fillW = st === 'approaching' ? barW * 0.78 : (st === 'strong' ? barW * 0.88 : (st === 'open' ? barW * 0.25 : barW * 0.35));
      var bxx = p.x + 14 + i * (barW + 4);
      var height = (st === 'approaching' || st === 'strong') ? 8 : 6;
      var color = st === 'approaching' ? '#F97316' : (st === 'strong' ? '#16a34a' : '#EAB308');
      s += '<rect x="' + bxx + '" y="' + barY + '" width="' + barW + '" height="' + height + '" rx="2" fill="rgba(157,175,165,0.10)"/>';
      s += '<rect x="' + bxx + '" y="' + barY + '" width="' + fillW + '" height="' + height + '" rx="2" fill="' + color + '"';
      if (st === 'approaching') s += '><animate attributeName="opacity" values="0.7;1;0.7" dur="1.6s" repeatCount="indefinite"/></rect>';
      else s += '/>';
      var arrow = st === 'approaching' || st === 'strong' ? ' ▲' : '';
      var tag = 'TP' + (i + 1) + ' ' + tpStatusCN(st) + arrow;
      s += '<text x="' + bxx + '" y="' + (barY + 18) + '" font-family="JetBrains Mono" font-size="9" font-weight="' + (st === 'approaching' || st === 'strong' ? '700' : '400') + '" fill="' + color + '">' + esc(tag) + '</text>';
    }

    s += '</g>';
    return s;
  }

  function renderBranchCard(p) {
    var n = p.node;
    var s = '<g class="snt-node" data-node-id="' + esc(n.id) + '" data-node-type="branch">';
    s += '<rect x="' + p.x + '" y="' + p.y + '" width="' + p.w + '" height="' + p.h + '" rx="8" fill="url(#snt-brG)"/>';
    s += '<text x="' + (p.x + 14) + '" y="' + (p.y + 23) + '" font-family="JetBrains Mono" font-size="11" font-weight="700" fill="#0f172a">' + esc(n.id) + '</text>';
    s += '<text x="' + (p.x + p.w - 14) + '" y="' + (p.y + 23) + '" font-family="JetBrains Mono" font-size="18" font-weight="700" fill="#0f172a" text-anchor="end">' + (n.confidence || 0) + '</text>';
    var titleStr = truncateForWidth(n.title || '', p.w - 28, 13);
    s += '<text x="' + (p.x + 14) + '" y="' + (p.y + 47) + '" font-family="Inter" font-size="13" font-weight="500" fill="#0f172a">' + esc(titleStr) + '</text>';
    s += '<text x="' + (p.x + 14) + '" y="' + (p.y + p.h - 14) + '" font-family="JetBrains Mono" font-size="10" fill="rgba(10,14,12,0.65)">' + esc(stateCN(n.state)) + ' · 互斥路径</text>';
    s += '</g>';
    return s;
  }

  function renderAssetCard(p, data, latestD) {
    var n = p.node;
    var sigs = findRelatedSignals(data, n.id);
    var todaySig = sigs.filter(function (sg) { return isLatestSignal(sg, latestD); })[0];
    var hasSignal = !!todaySig;

    var s = '<g class="snt-node" data-node-id="' + esc(n.id) + '" data-node-type="asset">';
    if (hasSignal) {
      s += '<rect x="' + (p.x - 4) + '" y="' + (p.y - 4) + '" width="' + (p.w + 8) + '" height="' + (p.h + 8) + '" rx="10" fill="none" stroke="#FBBF24" stroke-width="0.5" opacity="0.4"/>';
      s += '<rect x="' + p.x + '" y="' + p.y + '" width="' + p.w + '" height="' + p.h + '" rx="8" fill="url(#snt-cardBgGold)" stroke="#FBBF24" stroke-width="2"/>';
      // Left-edge gold ribbon (visual prominence boost)
      s += '<rect x="' + p.x + '" y="' + p.y + '" width="4" height="' + p.h + '" rx="2" fill="#FBBF24"/>';
    } else {
      s += '<rect x="' + p.x + '" y="' + p.y + '" width="' + p.w + '" height="' + p.h + '" rx="8" fill="url(#snt-cardBg)" stroke="#0e7490" stroke-width="1.2"/>';
    }
    var symbol = n.linked_symbol || '';
    var idLabel = symbol ? symbol + ' · ' + n.id : n.id;
    // ID + signal arrow on left; conf on right; reserve room for both
    // Reserve right-side conf width: ~50px (16px font, 3-4 chars), left padding 14, right padding 14, gap 8
    var idLeftX = p.x + (hasSignal ? 16 : 14);
    var idAvailable = p.w - (hasSignal ? 30 : 28) - 50 - 8 - (hasSignal ? 14 : 0);
    var idLabelTrim = truncateForWidthMono(idLabel, idAvailable, 11);
    s += '<text x="' + idLeftX + '" y="' + (p.y + 23) + '" font-family="JetBrains Mono" font-size="11" font-weight="700" fill="#0e7490">' + esc(idLabelTrim) + '</text>';
    // Big ⚡ icon (emphasized) right next to ID
    if (hasSignal) {
      var iconX = idLeftX + idAvailable + 4;
      s += '<text x="' + iconX + '" y="' + (p.y + 24) + '" font-size="14" fill="#FBBF24" font-weight="700">⚡</text>';
    }
    var confLabel = (n.confidence || 0) + (hasSignal ? ' ↑' : '');
    var confColor = hasSignal ? '#FBBF24' : '#0f172a';
    s += '<text x="' + (p.x + p.w - 14) + '" y="' + (p.y + 23) + '" font-family="JetBrains Mono" font-size="16" font-weight="700" fill="' + confColor + '" text-anchor="end">' + esc(String(confLabel)) + '</text>';
    var titleStr = truncateForWidth(n.title || '', p.w - 28, 12);
    s += '<text x="' + (p.x + 14) + '" y="' + (p.y + 43) + '" font-family="Inter" font-size="12" font-weight="500" fill="' + (hasSignal ? '#FBBF24' : '#0f172a') + '">' + esc(titleStr) + '</text>';
    s += '</g>';
    return s;
  }

  function wrapTitle(title, maxPerLine) {
    if (!title) return [''];
    if (title.length <= maxPerLine) return [title];
    return [title.slice(0, maxPerLine), title.slice(maxPerLine)];
  }

  function renderSvg(layout, data) {
    var latestD = latestDate(data.signals);
    var s = '<svg viewBox="0 0 ' + layout.W + ' ' + layout.H + '" preserveAspectRatio="xMidYMid meet">';
    // Defs
    // v4 配色: 卡片全白底 + 节点色 stroke 区分 + 深 slate 文字
    s += '<defs>' +
      '<linearGradient id="snt-rbG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#eef2ff"/><stop offset="100%" stop-color="#e0e7ff"/></linearGradient>' +
      '<linearGradient id="snt-brG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#f5f3ff"/><stop offset="100%" stop-color="#ede9fe"/></linearGradient>' +
      '<linearGradient id="snt-cardBg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#ffffff"/><stop offset="100%" stop-color="#fafbfc"/></linearGradient>' +
      '<linearGradient id="snt-cardBgGold" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#fef9c3"/><stop offset="100%" stop-color="#fef3c7"/></linearGradient>' +
      '</defs>';

    // Column labels (新色板: 蓝调家族 navy/blue/purple/dark cyan)
    s += '<text x="100" y="36" font-family="Cormorant Garamond" font-style="italic" font-size="14" fill="#1e3a8a" letter-spacing="0.10em">河岸 · I</text>';
    s += '<text x="500" y="36" font-family="Cormorant Garamond" font-style="italic" font-size="14" fill="#2563eb" letter-spacing="0.10em">河流 · II</text>';
    s += '<text x="900" y="36" font-family="Cormorant Garamond" font-style="italic" font-size="14" fill="#7c3aed" letter-spacing="0.10em">分叉 · III</text>';
    s += '<text x="1180" y="36" font-family="Cormorant Garamond" font-style="italic" font-size="14" fill="#0e7490" letter-spacing="0.10em">标的 · IV</text>';

    // Vertical column dividers
    s += '<line x1="320" y1="55" x2="320" y2="' + (layout.H - 30) + '" stroke="rgba(166,181,172,0.06)" stroke-dasharray="2,4"/>';
    s += '<line x1="730" y1="55" x2="730" y2="' + (layout.H - 30) + '" stroke="rgba(166,181,172,0.06)" stroke-dasharray="2,4"/>';
    s += '<line x1="1090" y1="55" x2="1090" y2="' + (layout.H - 30) + '" stroke="rgba(166,181,172,0.06)" stroke-dasharray="2,4"/>';

    // Flows (drawn first so nodes overlay)
    s += renderFlows(layout, data, latestD);

    // Nodes
    layout.rb.forEach(function (p) { s += renderRBCard(p, data, latestD); });
    layout.river.forEach(function (p) { s += renderRiverCard(p, data, latestD); });
    layout.branch.forEach(function (p) { s += renderBranchCard(p); });
    layout.asset.forEach(function (p) { s += renderAssetCard(p, data, latestD); });

    s += '</svg>';
    return s;
  }

  // ===== Hero / Today / Legend / Below panels =====
  function renderHero(data) {
    var sigCnt = (data.signals || []).length;
    var classCounts = {};
    (data.signals || []).forEach(function (sg) {
      var k = sg.classification || '其他';
      classCounts[k] = (classCounts[k] || 0) + 1;
    });
    var classSummary = Object.keys(classCounts).map(function (k) { return classCounts[k] + ' ' + k; }).join(' / ') || '—';

    var tpApproachCnt = 0, tpStrongCnt = 0;
    var firstApproach = null;
    (data.tipping_points || []).forEach(function (tp) {
      var st = (tp.status || '').toLowerCase();
      if (st === 'approaching') {
        tpApproachCnt++;
        if (!firstApproach) firstApproach = tp;
      }
      if (st === 'strong') tpStrongCnt++;
    });
    var tpStatus = (data.tipping_points || []).reduce(function (a, tp) {
      var k = (tp.status || 'watching').toLowerCase();
      a[k] = (a[k] || 0) + 1;
      return a;
    }, {});
    var stats = data.stats || {};

    var html = '<div class="snt-hero">' +
      '<div>' +
        '<h2>' + esc(data.namespace || 'GP') + ' Sentinel<em> · </em>河流图</h2>' +
        '<p>河岸 → 河流 → 分叉 → 标的，左→右流向。每个节点是<strong style="color:var(--sentinel-gold-bright)">完整信息卡</strong>——ID、标题、置信度、TP、当日信号 +Δp 全部内嵌。<strong style="color:var(--sentinel-gold-bright)">金色流动连线</strong> = 信号传导链。' +
        '<span style="display:block;margin-top:6px;font-size:12px;color:var(--sentinel-fg-3)">悬停节点查看详情，点击展开 drawer。</span>' +
        '</p>' +
      '</div>' +
      '<div class="snt-hero-stats">' +
        '<div class="snt-stat warm"><div class="snt-stat-lbl">今日信号</div><div class="snt-stat-val">' + sigCnt + '</div><div class="snt-stat-sub">' + esc(classSummary) + '</div></div>' +
        '<div class="snt-stat ' + (tpApproachCnt > 0 ? 'warn' : '') + '"><div class="snt-stat-lbl">TP 接近触发</div><div class="snt-stat-val">' + tpApproachCnt + '</div><div class="snt-stat-sub">' + (firstApproach ? esc(firstApproach.hypothesis_id + ' · ' + (firstApproach.event || '').slice(0, 26)) : '—') + '</div></div>' +
        '<div class="snt-stat"><div class="snt-stat-lbl">假设</div><div class="snt-stat-val" style="color:var(--sentinel-rb)">' + ((stats.riverbank_count || 0) + (stats.river_count || 0) + (stats.branch_count || 0) + (stats.asset_count || 0)) + '</div><div class="snt-stat-sub">' + (stats.riverbank_count || 0) + ' RB · ' + (stats.river_count || 0) + ' 河流 · ' + (stats.branch_count || 0) + ' 分叉 · ' + (stats.asset_count || 0) + ' 标的</div></div>' +
        '<div class="snt-stat"><div class="snt-stat-lbl">监控拐点</div><div class="snt-stat-val" style="color:var(--sentinel-water)">' + (stats.tp_count || 0) + '</div><div class="snt-stat-sub">' + (tpStatus.watching || 0) + ' 观察 / ' + tpApproachCnt + ' 接近 / ' + tpStrongCnt + ' 趋强</div></div>' +
      '</div>' +
    '</div>';
    return html;
  }

  function renderToday(data) {
    var latestD = latestDate(data.signals);
    var todaySigs = (data.signals || []).filter(function (sg) { return isLatestSignal(sg, latestD); });
    if (!todaySigs.length) {
      return '<div class="snt-today"><div class="snt-today-lbl">/ Latest · ' + esc(latestD) + '</div><div class="snt-today-text">最近无新信号。Sentinel pipeline 每日运行后写入 signal_log.csv。</div></div>';
    }
    var summary = todaySigs.map(function (sg) {
      var sign = parseFloat(sg.delta) >= 0 ? '+' : '';
      return sg.hypothesis_id + ' ' + sign + (sg.delta || '0') + ' ' + (sg.classification || '');
    }).join(' / ');
    return '<div class="snt-today"><div class="snt-today-lbl">/ Latest · ' + esc(latestD) + ' · 关键叙事</div><div class="snt-today-text"><strong>' + todaySigs.length + ' 条新信号</strong>触达：' + esc(summary) + '。点击金边节点查看完整 reasoning。</div></div>';
  }

  function renderLegend() {
    return '<div class="snt-legend">' +
      '<div class="snt-legend-group">' +
        '<div class="snt-legend-item"><span style="display:block;width:12px;height:12px;border-radius:2px;background:var(--sentinel-rb)"></span>河岸</div>' +
        '<div class="snt-legend-item"><span style="display:block;width:12px;height:12px;border-radius:2px;background:var(--sentinel-water)"></span>河流</div>' +
        '<div class="snt-legend-item"><span style="display:block;width:12px;height:12px;border-radius:2px;background:var(--sentinel-branch)"></span>分叉</div>' +
        '<div class="snt-legend-item"><span style="display:block;width:12px;height:12px;border-radius:2px;background:var(--sentinel-asset)"></span>标的</div>' +
      '</div>' +
      '<div class="snt-legend-group">' +
        '<div class="snt-legend-item"><span style="display:block;width:22px;height:5px;background:var(--sentinel-tp-watch);border-radius:2px"></span>TP 观察</div>' +
        '<div class="snt-legend-item"><span style="display:block;width:22px;height:5px;background:var(--sentinel-tp-approach);border-radius:2px;box-shadow:0 0 6px var(--sentinel-tp-approach)"></span>TP 接近</div>' +
        '<div class="snt-legend-item"><span style="display:block;width:22px;height:5px;background:var(--sentinel-tp-strong);border-radius:2px"></span>TP 趋强</div>' +
      '</div>' +
      '<div class="snt-legend-group">' +
        '<div class="snt-legend-item"><span style="display:block;width:11px;height:11px;border-radius:50%;background:var(--sentinel-gold);box-shadow:0 0 8px var(--sentinel-gold)"></span>当日信号</div>' +
        '<div class="snt-legend-item"><span style="display:block;width:24px;height:2px;background:var(--sentinel-gold)"></span>信号传导链</div>' +
      '</div>' +
    '</div>';
  }

  function renderBelowPanels(data) {
    // TP Watchlist (sorted by status priority)
    var tps = (data.tipping_points || []).slice();
    var sigs = (data.signals || []).slice();

    // TP Watchlist 全展开（不限制 6 条，spec 默认展开规则）
    var tpRows = tps.map(function (tp) {
      var st = (tp.status || 'watching').toLowerCase();
      return '<div class="snt-tp-row"><span class="hyp-col">' + esc(tp.hypothesis_id) + '</span><span>' + esc((tp.event || '').slice(0, 32)) + '</span><div class="snt-progress"><div class="snt-progress-fill ' + esc(st) + '" style="width:' + (st === 'approaching' ? 78 : (st === 'strong' ? 88 : (st === 'open' ? 25 : 35))) + '%"></div></div><span class="last-col">' + esc((tp.last_checked || '').slice(5)) + '</span></div>';
    }).join('');
    var tpPanel = tps.length
      ? '<div class="snt-panel"><h3><span class="snt-live-dot"></span>拐点监控</h3>' + tpRows + '</div>'
      : '<div class="snt-panel"><h3>拐点监控</h3><div class="snt-empty">无监控拐点</div></div>';

    // Signal Feed 全展开（不限制 5 条）
    var sigCards = sigs.map(function (sg) {
      var cls = classificationCN(sg.classification);
      var sign = parseFloat(sg.delta) >= 0 ? '+' : '';
      var deltaCls = parseFloat(sg.delta) < 0 ? 'neg' : '';
      var trans = (sg.old_score_status && sg.new_score_status && sg.old_score_status !== sg.new_score_status)
        ? sg.old_score_status + ' → ' + sg.new_score_status : '';
      return '<div class="snt-sig-card"><div class="snt-sig-head">' +
        '<span class="date">' + esc((sg.date || '').slice(5)) + '</span>' +
        '<span class="hyp">' + esc(sg.hypothesis_id) + '</span>' +
        '<span class="cls ' + cls.cls + '">' + esc(cls.label) + '</span>' +
        '<span class="delta ' + deltaCls + '">' + esc(sign + (sg.delta || '0')) + '</span>' +
        '<span class="lr">LR ' + esc(sg.lr || '—') + '</span>' +
        '</div><div class="snt-sig-text">' + esc((sg.signal || '').slice(0, 200) + ((sg.signal || '').length > 200 ? '…' : '')) + (trans ? '<div style="font-family:JetBrains Mono;font-size:11px;color:var(--sentinel-fg-3);margin-top:4px">' + esc(trans) + '</div>' : '') + '</div></div>';
    }).join('');
    var sigPanel = sigs.length
      ? '<div class="snt-panel"><h3><span class="snt-live-dot"></span>当日信号</h3>' + sigCards + '</div>'
      : '<div class="snt-panel"><h3>当日信号</h3><div class="snt-empty">尚无信号</div></div>';

    return '<div class="snt-below">' + tpPanel + sigPanel + '</div>';
  }

  // ===== Tooltip =====
  var tooltipEl = null;
  var tooltipTimer = null;

  function ensureTooltip() {
    if (tooltipEl) return tooltipEl;
    tooltipEl = document.createElement('div');
    tooltipEl.id = 'snt-tooltip';
    document.body.appendChild(tooltipEl);
    return tooltipEl;
  }

  function positionTooltip(e) {
    if (!tooltipEl) return;
    var w = tooltipEl.offsetWidth || 280;
    var h = tooltipEl.offsetHeight || 100;
    var x = e.clientX + 16;
    var y = e.clientY + 16;
    if (x + w > window.innerWidth - 8) x = e.clientX - w - 16;
    if (y + h > window.innerHeight - 8) y = e.clientY - h - 16;
    if (x < 8) x = 8;
    if (y < 8) y = 8;
    tooltipEl.style.left = x + 'px';
    tooltipEl.style.top = y + 'px';
  }

  function showTooltip(content, e) {
    ensureTooltip();
    tooltipEl.innerHTML = content;
    positionTooltip(e);
    tooltipEl.classList.add('visible');
  }
  function hideTooltip() {
    if (tooltipTimer) { clearTimeout(tooltipTimer); tooltipTimer = null; }
    if (tooltipEl) tooltipEl.classList.remove('visible');
  }

  function tooltipForNode(data, nodeId, nodeType) {
    var found = findNode(data, nodeId);
    if (!found) return '';
    var n = found.node;
    var latestD = latestDate(data.signals);
    var sigs = findRelatedSignals(data, nodeId);
    var todaySig = sigs.filter(function (sg) { return isLatestSignal(sg, latestD); })[0];
    var tps = findRelatedTPs(data, nodeId);
    var children = findChildren(data, nodeId);

    var head = '';
    var hint = '点击查看详情';
    if (nodeType === 'riverbank') {
      head = '<div class="snt-tt-head"><span>' + esc(n.id) + '</span><span class="layer">河岸</span><span class="conf">' + (n.confidence || 0) + '</span></div>';
    } else if (nodeType === 'river') {
      head = '<div class="snt-tt-head">' + (todaySig ? '<span class="pulse"></span>' : '') + '<span>' + esc(n.id) + '</span><span class="layer">河流' + (todaySig ? ' · 当日信号' : '') + '</span><span class="conf">' + (n.confidence || 0) + '</span></div>';
    } else if (nodeType === 'branch') {
      head = '<div class="snt-tt-head"><span>' + esc(n.id) + '</span><span class="layer">分叉 · ' + esc(stateCN(n.state)) + '</span><span class="conf">' + (n.confidence || 0) + '</span></div>';
    } else if (nodeType === 'asset') {
      head = '<div class="snt-tt-head">' + (todaySig ? '<span class="pulse"></span>' : '') + '<span>' + esc(n.linked_symbol || '') + ' · ' + esc(n.id) + '</span><span class="conf">' + (n.confidence || 0) + (todaySig ? ' ↑' : '') + '</span></div>';
    }

    var html = head + '<hr class="snt-tt-divider">';
    html += '<div class="snt-tt-title">' + esc(n.title || '') + '</div>';

    if (todaySig) {
      var sign = parseFloat(todaySig.delta) >= 0 ? '+' : '';
      html += '<div class="snt-tt-signal">⚡ ' + esc((todaySig.date || '').slice(5)) + ' ' + esc(classificationCN(todaySig.classification).label) + ' ' + sign + esc(todaySig.delta || '0') + ' (LR ' + esc(todaySig.lr || '—') + ')</div>';
    }

    var statement = n.statement || '';
    if (statement && statement !== n.title) {
      html += '<div class="snt-tt-body">' + esc(statement.length > 130 ? statement.slice(0, 130) + '…' : statement) + '</div>';
    }

    var meta = [];
    if (nodeType === 'riverbank') {
      meta.push((n.child_count !== undefined ? n.child_count : children.length) + ' 子假设');
      meta.push(esc(stateCN(n.state)));
      if (n.last_updated) meta.push(esc(n.last_updated));
    } else if (nodeType === 'river' || nodeType === 'asset') {
      if (tps.length) {
        var tpInfo = tps.length + ' 个拐点';
        var appr = tps.filter(function (tp) { return (tp.status || '').toLowerCase() === 'approaching'; }).length;
        var strg = tps.filter(function (tp) { return (tp.status || '').toLowerCase() === 'strong'; }).length;
        if (appr) tpInfo += ' · ' + appr + ' 接近 ▲';
        if (strg) tpInfo += ' · ' + strg + ' 趋强 ▲';
        meta.push(tpInfo);
      }
      if (sigs.length && !todaySig) {
        var recent = sigs[0];
        meta.push('最近 ' + esc((recent.date || '').slice(5)) + ' ' + esc(classificationCN(recent.classification).label));
      }
    } else if (nodeType === 'branch') {
      var paths = n.paths;
      try {
        if (typeof paths === 'string' && paths.trim().startsWith('[')) paths = JSON.parse(paths);
      } catch (e) { paths = null; }
      if (paths && paths.length) {
        meta.push('互斥路径：' + paths.map(function (p) { return p.id + ' (' + p.p + '%)'; }).join(' · '));
      } else {
        meta.push(esc(stateCN(n.state)));
      }
    }
    if (meta.length) html += '<div class="snt-tt-meta">' + meta.join(' · ') + '</div>';

    html += '<div class="snt-tt-hint">' + hint + '</div>';
    return html;
  }

  function tooltipForTP(tp, hypMap) {
    var st = (tp.status || 'watching').toLowerCase();
    var head = '<div class="snt-tt-head"><span>' + esc(tp.id) + '</span><span class="layer">TP · ' + esc(tpStatusCN(st)) + (st === 'approaching' || st === 'strong' ? ' ▲' : '') + '</span></div>';
    var html = head + '<hr class="snt-tt-divider">';
    html += '<div class="snt-tt-title">' + esc(tp.event || '') + '</div>';
    if (tp.quantitative) html += '<div class="snt-tt-body"><b>阈值：</b>' + esc(tp.quantitative) + '</div>';
    if (tp.current) html += '<div class="snt-tt-body"><b>当前：</b>' + esc((tp.current || '').slice(0, 100)) + '</div>';
    if (tp.if_triggered) html += '<div class="snt-tt-body" style="color:var(--sentinel-rb)">↑ ' + esc((tp.if_triggered || '').slice(0, 80)) + '</div>';
    if (tp.if_failed) html += '<div class="snt-tt-body" style="color:#dc2626">↓ ' + esc((tp.if_failed || '').slice(0, 80)) + '</div>';
    return html;
  }

  function tooltipForSignal(sg) {
    var sign = parseFloat(sg.delta) >= 0 ? '+' : '';
    var head = '<div class="snt-tt-head"><span>' + esc(sg.hypothesis_id) + '</span><span class="layer">' + esc((sg.date || '').slice(5)) + ' · ' + esc(classificationCN(sg.classification).label) + '</span><span class="conf">' + sign + esc(sg.delta || '0') + '</span></div>';
    var html = head + '<hr class="snt-tt-divider">';
    html += '<div class="snt-tt-body">' + esc((sg.signal || '').slice(0, 160)) + '</div>';
    if (sg.old_score_status && sg.new_score_status && sg.old_score_status !== sg.new_score_status) {
      html += '<div class="snt-tt-meta">' + esc(sg.old_score_status) + ' → ' + esc(sg.new_score_status) + ' · LR ' + esc(sg.lr || '—') + '</div>';
    }
    return html;
  }

  // ===== Drawer =====
  var drawerEl = null, drawerBackdrop = null;
  var currentDrawerNodeId = null;

  function ensureDrawer() {
    if (drawerEl) return;
    drawerBackdrop = document.createElement('div');
    drawerBackdrop.id = 'snt-drawer-backdrop';
    drawerBackdrop.addEventListener('click', closeDrawer);
    document.body.appendChild(drawerBackdrop);

    drawerEl = document.createElement('aside');
    drawerEl.id = 'snt-drawer';
    document.body.appendChild(drawerEl);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && drawerEl.classList.contains('visible')) closeDrawer();
    });
  }

  function openDrawer(data, nodeId, nodeType) {
    ensureDrawer();
    currentDrawerNodeId = nodeId;
    drawerEl.innerHTML = renderDrawerContent(data, nodeId, nodeType);
    bindDrawerInteractions(data);
    drawerEl.classList.add('visible');
    drawerBackdrop.classList.add('visible');
    hideTooltip();
  }

  function closeDrawer() {
    if (!drawerEl) return;
    drawerEl.classList.remove('visible');
    drawerBackdrop.classList.remove('visible');
    currentDrawerNodeId = null;
  }

  function bindDrawerInteractions(data) {
    if (!drawerEl) return;
    // Close button
    var closeBtn = drawerEl.querySelector('.snt-drawer-close');
    if (closeBtn) closeBtn.addEventListener('click', closeDrawer);

    // Related node clicks
    drawerEl.querySelectorAll('[data-jump-id]').forEach(function (el) {
      el.addEventListener('click', function () {
        var jid = el.getAttribute('data-jump-id');
        var jtype = el.getAttribute('data-jump-type');
        openDrawer(data, jid, jtype);
      });
    });

    // TP card toggle
    drawerEl.querySelectorAll('.snt-tp-card').forEach(function (card) {
      card.addEventListener('click', function () {
        card.classList.toggle('expanded');
        var toggle = card.querySelector('.snt-tp-card-toggle');
        if (toggle) toggle.textContent = card.classList.contains('expanded') ? '▴' : '▾';
      });
    });
  }

  function renderDrawerContent(data, nodeId, nodeType) {
    var found = findNode(data, nodeId);
    if (!found) return '<div class="snt-drawer-header"><div class="snt-drawer-title">未找到节点</div></div>';
    var n = found.node;
    var actualType = nodeType || found.type;
    var latestD = latestDate(data.signals);
    var sigs = findRelatedSignals(data, nodeId);
    var todaySig = sigs.filter(function (sg) { return isLatestSignal(sg, latestD); })[0];
    var hasSignal = !!todaySig;

    // Header
    var idClass = actualType === 'riverbank' ? '' : actualType;
    var layerCN = { riverbank: '河岸', river: '河流', branch: '分叉', asset: '标的' }[actualType] || '';
    var confLbl = (n.confidence || 0) + (hasSignal ? ' ↑' : '');
    var idBadge = n.id;
    if (actualType === 'asset' && n.linked_symbol) idBadge = n.linked_symbol + ' · ' + n.id;

    var header = '<header class="snt-drawer-header' + (hasSignal ? ' signal' : '') + '">' +
      '<button class="snt-drawer-close" aria-label="关闭">×</button>' +
      '<div class="snt-drawer-meta">' +
        '<span class="id ' + idClass + '">' + esc(idBadge) + '</span>' +
        '<span class="layer-chip">' + esc(layerCN) + '</span>' +
        '<span class="conf' + (hasSignal ? ' up' : '') + '">' + esc(String(confLbl)) + '</span>' +
      '</div>' +
      '<div class="snt-drawer-title">' + esc(n.title || '') + '</div>' +
    '</header>';

    // Body sections
    var body = '<div class="snt-drawer-body">';

    // S1 Statement & Why
    body += '<div class="snt-section">';
    body += '<div class="snt-section-head">假设</div>';
    if (n.statement) {
      body += '<div class="snt-prose-label">Statement</div>';
      body += '<div class="snt-prose">' + esc(n.statement) + '</div>';
    }
    if (n.why) {
      body += '<div class="snt-prose-label">Why · 依据</div>';
      body += '<div class="snt-prose">' + esc(n.why) + '</div>';
    }
    if (!n.statement && !n.why && n.title) {
      body += '<div class="snt-prose">' + esc(n.title) + '</div>';
    }
    body += '</div>';

    // S2 关联（父子）
    var parents = findParents(data, n);
    var children = findChildren(data, nodeId);
    if (parents.length || children.length) {
      body += '<div class="snt-section"><div class="snt-section-head">关联</div>';
      if (parents.length) {
        body += '<div class="snt-prose-label">父假设 ↑</div>';
        parents.forEach(function (p) {
          var pType = p.id.match(/-RB\d+$/) ? 'rb' : (p.id.match(/-H\d+-F\d+$/) ? 'branch' : (p.id.match(/-H\d+$/) ? 'river' : 'asset'));
          body += '<div class="snt-related-row" data-jump-id="' + esc(p.id) + '" data-jump-type="' + (pType === 'rb' ? 'riverbank' : pType) + '">' +
            '<span class="arrow">↑</span>' +
            '<span class="id-mini ' + pType + '">' + esc(p.id) + '</span>' +
            '<span class="title-mini">' + esc(p.title || '') + '</span>' +
            '<span class="conf-mini">' + (p.confidence || 0) + '</span>' +
          '</div>';
        });
      }
      if (children.length) {
        body += '<div class="snt-prose-label" style="margin-top:14px">子假设 →</div>';
        children.slice(0, 8).forEach(function (c) {
          var cType = c.id.match(/-RB\d+$/) ? 'rb' : (c.id.match(/-H\d+-F\d+$/) ? 'branch' : (c.id.match(/-H\d+$/) ? 'river' : 'asset'));
          body += '<div class="snt-related-row" data-jump-id="' + esc(c.id) + '" data-jump-type="' + (cType === 'rb' ? 'riverbank' : cType) + '">' +
            '<span class="arrow">→</span>' +
            '<span class="id-mini ' + cType + '">' + esc(c.id) + '</span>' +
            '<span class="title-mini">' + esc(c.title || '') + '</span>' +
            '<span class="conf-mini">' + (c.confidence || 0) + '</span>' +
          '</div>';
        });
        if (children.length > 8) {
          body += '<div class="snt-prose-label" style="text-align:center;margin-top:6px">+ ' + (children.length - 8) + ' 个子假设</div>';
        }
      }
      body += '</div>';
    }

    // S3 拐点监控 (river / asset)
    if (actualType === 'river' || actualType === 'branch' || actualType === 'asset') {
      var tps = findRelatedTPs(data, nodeId);
      if (tps.length) {
        body += '<div class="snt-section"><div class="snt-section-head">拐点监控（' + tps.length + '）</div>';
        tps.forEach(function (tp) {
          var st = (tp.status || 'watching').toLowerCase();
          var stCN = tpStatusCN(st);
          var arrow = (st === 'approaching' || st === 'strong') ? ' ▲' : '';
          body += '<div class="snt-tp-card ' + st + '">' +
            '<div class="snt-tp-card-head">' +
              '<span class="snt-tp-card-id">' + esc(tp.id) + ' · ' + esc(stCN) + arrow + '</span>' +
              '<span class="snt-tp-card-title">' + esc(tp.event || '') + '</span>' +
              '<span class="snt-tp-card-toggle">▾</span>' +
            '</div>' +
            '<div class="snt-tp-card-progress"><div class="snt-tp-card-progress-fill ' + st + '"></div></div>' +
            '<div class="snt-tp-card-detail">';
          if (tp.current) body += '<div class="field"><span class="field-label">当前</span><br>' + esc(tp.current) + '</div>';
          if (tp.quantitative) body += '<div class="field"><span class="field-label">阈值</span><br>' + esc(tp.quantitative) + '</div>';
          if (tp.qualitative && tp.qualitative !== tp.quantitative) body += '<div class="field"><span class="field-label">定性条件</span><br>' + esc(tp.qualitative) + '</div>';
          if (tp.if_triggered) body += '<div class="field"><span class="field-label path-up">↑ 触发</span><br>' + esc(tp.if_triggered) + '</div>';
          if (tp.if_failed) body += '<div class="field"><span class="field-label path-down">↓ 失败</span><br>' + esc(tp.if_failed) + '</div>';
          var meta = [];
          if (tp.last_checked) meta.push('last ' + tp.last_checked);
          if (tp.weight) meta.push('w' + tp.weight);
          if (meta.length) body += '<div class="field"><span class="field-label">' + meta.join(' · ') + '</span></div>';
          body += '</div></div>';
        });
        body += '</div>';
      }
    }

    // S4 Signal Timeline
    if (sigs.length) {
      body += '<div class="snt-section"><div class="snt-section-head">Signal Timeline（' + sigs.length + '）</div>';
      sigs.slice(0, 5).forEach(function (sg) {
        var cls = classificationCN(sg.classification);
        var sign = parseFloat(sg.delta) >= 0 ? '+' : '';
        var deltaCls = parseFloat(sg.delta) < 0 ? 'neg' : '';
        var trans = (sg.old_score_status && sg.new_score_status && sg.old_score_status !== sg.new_score_status)
          ? sg.old_score_status + ' → ' + sg.new_score_status : '';
        var pPriorPost = (sg.prior_p && sg.posterior_p) ? 'p ' + sg.prior_p + ' → ' + sg.posterior_p : '';
        body += '<div class="snt-drawer-sig">' +
          '<div class="snt-drawer-sig-head">' +
            (isLatestSignal(sg, latestD) ? '<span style="color:var(--sentinel-gold-bright)">⚡</span>' : '') +
            '<span class="date">' + esc((sg.date || '').slice(5)) + '</span>' +
            '<span class="hyp">' + esc(sg.hypothesis_id) + '</span>' +
            '<span class="cls ' + cls.cls + '">' + esc(cls.label) + '</span>' +
            '<span class="delta ' + deltaCls + '">' + esc(sign + (sg.delta || '0')) + '</span>' +
            '<span class="lr">LR ' + esc(sg.lr || '—') + '</span>' +
          '</div>' +
          '<div class="snt-drawer-sig-text">' + esc(sg.signal || '') + '</div>' +
          (sg.reasoning ? '<div class="snt-drawer-sig-reasoning">' + esc(sg.reasoning.slice(0, 280)) + (sg.reasoning.length > 280 ? '…' : '') + '</div>' : '') +
          ((trans || pPriorPost) ? '<div class="snt-drawer-sig-trans">' + esc(trans + (trans && pPriorPost ? ' · ' : '') + pPriorPost) + '</div>' : '') +
        '</div>';
      });
      if (sigs.length > 5) {
        body += '<div class="snt-prose-label" style="text-align:center;margin-top:6px">+ ' + (sigs.length - 5) + ' 条历史信号</div>';
      }
      body += '</div>';
    }

    // S5 决策框架 (river / asset)
    if ((actualType === 'river' || actualType === 'asset') && (n.action_if_falsified || n.t_stage)) {
      body += '<div class="snt-section"><div class="snt-section-head">决策</div>';
      if (n.action_if_falsified) body += '<div class="snt-decision-row"><span class="key">action_if_false</span><span class="value">' + esc(n.action_if_falsified) + '</span></div>';
      if (n.t_stage) body += '<div class="snt-decision-row"><span class="key">t_stage</span><span class="value">' + esc(n.t_stage) + '</span></div>';
      body += '</div>';
    }

    body += '</div>'; // end body

    return header + body;
  }

  // ===== Bind interactions =====
  function bindNodeInteractions(host, data) {
    var nodes = host.querySelectorAll('.snt-node');
    nodes.forEach(function (node) {
      var nodeId = node.getAttribute('data-node-id');
      var nodeType = node.getAttribute('data-node-type');

      node.addEventListener('mouseenter', function (e) {
        if (tooltipTimer) clearTimeout(tooltipTimer);
        tooltipTimer = setTimeout(function () {
          showTooltip(tooltipForNode(data, nodeId, nodeType), e);
        }, 200);
      });
      node.addEventListener('mousemove', function (e) {
        if (tooltipEl && tooltipEl.classList.contains('visible')) positionTooltip(e);
      });
      node.addEventListener('mouseleave', hideTooltip);
      node.addEventListener('click', function (e) {
        e.stopPropagation();
        hideTooltip();
        openDrawer(data, nodeId, nodeType);
      });
    });
  }

  // ===== Public entry =====
  window.renderSentinel = function (data, hostSelector) {
    if (!data || !data.namespace) {
      return; // empty / no sentinel data
    }
    var host = typeof hostSelector === 'string' ? document.querySelector(hostSelector) : hostSelector;
    if (!host) {
      console.warn('[sentinel-page] host not found:', hostSelector);
      return;
    }

    var layout = computeLayout(data);
    var html = renderHero(data) +
      renderToday(data) +
      renderLegend() +
      '<div class="snt-canvas">' + renderSvg(layout, data) + '</div>' +
      renderBelowPanels(data);

    host.innerHTML = html;
    bindNodeInteractions(host, data);
  };

  window.closeSentinelDrawer = closeDrawer;
})();
