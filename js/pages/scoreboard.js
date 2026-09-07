import { api } from '../api.js';
import { toast, statusPill, approvalPill, MONTHS_TH, OPERATOR_SYMBOL, escapeHtml as esc } from '../ui.js';
import { CURRENT_YEAR_CE } from '../config.js';
import { openPasteImportModal } from '../pasteImport.js';
import { FREQ_LABEL, periodsInMonth } from '../tacticPeriods.js';

let ctx, viewingUserId, subordinates = [], selectedMonth, scoreData = [], goalMeta = new Map();

export async function render(container, context) {
  ctx = context;
  viewingUserId = context.user.user_id;
  selectedMonth = new Date().getMonth() + 1;

  if (context.user.role !== 'STAFF') {
    try { subordinates = await api.getSubordinates(); } catch { subordinates = []; }
  }

  container.innerHTML = `
    <div class="flex-between mb-16" style="flex-wrap:wrap;gap:12px">
      ${subordinates.length ? `
        <select id="viewer-select" style="width:260px">
          <option value="${context.user.user_id}">🙋 ของฉันเอง (${esc(context.user.first_name)})</option>
          ${subordinates.map(s => `<option value="${s.user_id}">${esc(s.first_name)} ${esc(s.last_name)} — ${esc(s.position_title)}</option>`).join('')}
        </select>
      ` : '<div></div>'}
      <div class="flex gap-8">
        <button class="btn btn-sm" id="import-score-btn">📋 นำเข้าผลงานทั้งปีจาก Excel</button>
        <button class="btn btn-primary" id="submit-month-btn">ส่งรายงานเดือนนี้ให้หัวหน้าอนุมัติ</button>
      </div>
    </div>

    <div class="hint-box mb-16">
      💡 เป้าหมายกำหนดที่หน้า "เป้าหมาย &amp; ทีเด็ด" เพียงจุดเดียว (รายปี) — หน้านี้กรอกได้แค่ <strong>ผลงานจริง</strong> ของแต่ละเดือนเท่านั้น
      ถ้าเป้าหมายมีมากกว่า 1 ตัววัด แถวสรุป "ภาพรวม" จะใช้ตัววัดที่แย่ที่สุดในเดือนนั้นเป็นตัวชี้ขาดว่าผ่านหรือไม่
    </div>

    <div class="card mb-16" style="padding:10px 14px">
      <div class="flex gap-8" id="month-tabs" style="flex-wrap:wrap"></div>
    </div>

    <div class="card">
      <div class="card-title">Scoreboard เดือน <span id="month-label"></span> ${CURRENT_YEAR_CE + 543}</div>
      <div id="score-table-wrap"></div>
    </div>
  `;

  document.getElementById('month-tabs').innerHTML = MONTHS_TH.map((m, i) => `
    <button class="btn btn-sm" data-month="${i + 1}" style="${i + 1 === selectedMonth ? 'background:var(--accent);color:#0B1020;border-color:var(--accent)' : ''}">${m}</button>
  `).join('');
  document.querySelectorAll('#month-tabs [data-month]').forEach(b => b.onclick = () => {
    selectedMonth = Number(b.dataset.month);
    document.querySelectorAll('#month-tabs [data-month]').forEach(x => {
      const active = Number(x.dataset.month) === selectedMonth;
      x.style.background = active ? 'var(--accent)' : '';
      x.style.color = active ? '#0B1020' : '';
      x.style.borderColor = active ? 'var(--accent)' : '';
    });
    renderTable();
  });

  const viewerSelect = document.getElementById('viewer-select');
  if (viewerSelect) viewerSelect.onchange = async (e) => { viewingUserId = Number(e.target.value); await loadData(); };
  document.getElementById('submit-month-btn').onclick = submitMonth;
  document.getElementById('import-score-btn').onclick = () => openScoreboardImportModal();

  await loadData();
}

async function loadData() {
  document.getElementById('score-table-wrap').innerHTML = `<div class="loading-page"><span class="spinner"></span></div>`;
  const [goals, sb] = await Promise.all([
    api.listGoals(viewingUserId, CURRENT_YEAR_CE),
    api.getScoreboard(viewingUserId, CURRENT_YEAR_CE),
  ]);
  goalMeta = new Map(goals.map(g => [g.goal_id, g]));
  scoreData = sb; // 1 แถวต่อ (goal, metric, month) — ดู sql/patch_005 ของ get_scoreboard
  renderTable();
}

function renderTable() {
  document.getElementById('month-label').textContent = MONTHS_TH[selectedMonth - 1];
  const wrap = document.getElementById('score-table-wrap');

  const goalIds = [...new Set(scoreData.map(r => r.goal_id))];
  if (!goalIds.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="icon">🗓️</div>ยังไม่มีเป้าหมายในปีนี้ กรุณาไปที่หน้า "เป้าหมาย & ทีเด็ด" ก่อน</div>`;
    return;
  }

  const groups = goalIds.map(gid => {
    const rowsThisMonth = scoreData.filter(r => r.goal_id === gid && r.month_num === selectedMonth);
    const meta = goalMeta.get(gid);
    return { gid, title: rowsThisMonth[0]?.goal_title, weight: rowsThisMonth[0]?.weight_percentage, meta, metrics: rowsThisMonth };
  });

  wrap.innerHTML = `<table>
    <thead><tr>
      <th>เป้าหมาย / ตัววัด</th><th>น้ำหนัก</th><th>เป้าหมาย</th><th>ผลงานจริงเดือนนี้</th>
      <th>ส่วนต่าง</th><th>% สำเร็จ</th><th>สถานะ</th><th>การอนุมัติ</th>
    </tr></thead>
    <tbody>
      ${groups.map(gr => {
        const overall = gr.metrics[0]; // overall_* ซ้ำเท่ากันทุกแถวในกลุ่มเดียวกัน
        return `
        <tr style="background:var(--bg-panel-2)">
          <td>
            <strong>${esc(gr.title)}</strong>
            ${gr.meta?.is_shared ? `<span class="pill yellow" style="margin-left:6px"><span class="dot"></span>ถือร่วมกับ ${esc(gr.meta.owner_name)}</span>` : ''}
            <span class="text-dim" style="font-size:12px">(${gr.metrics.length} ตัววัด)</span>
          </td>
          <td class="text-muted">${gr.weight ?? '-'}%</td>
          <td class="text-dim" style="font-size:12px">ภาพรวม</td>
          <td class="text-dim" style="font-size:12px">(ตัววัดแย่สุด)</td>
          <td>-</td>
          <td><strong>${overall?.overall_achievement_percentage != null ? overall.overall_achievement_percentage + '%' : '-'}</strong></td>
          <td>${statusPill(overall?.overall_status_color)}</td>
          <td></td>
        </tr>
        ${gr.metrics.map(m => `
          <tr>
            <td style="padding-left:26px" class="text-muted">${esc(m.metric_unit || '-')}</td>
            <td></td>
            <td class="text-muted"><strong>${OPERATOR_SYMBOL[m.evaluation_operator] || '≥'} ${m.target_val ?? '-'}</strong></td>
            <td class="month-cell">${gr.meta?.is_shared
              ? `<span class="text-muted">${m.actual_val ?? '-'}</span>`
              : `<input type="number" step="0.01" data-actual="${m.metric_id}" value="${m.actual_val ?? ''}">`}</td>
            <td class="text-muted">${m.variance_val ?? '-'}</td>
            <td class="text-muted">${m.achievement_percentage != null ? m.achievement_percentage + '%' : '-'}</td>
            <td>${statusPill(m.status_color)}</td>
            <td>
              ${approvalPill(m.approval_status || 'DRAFT')}
              ${m.approval_status === 'REJECTED' && m.reviewer_comments ? `<div class="text-dim" style="font-size:11.5px;margin-top:4px">${esc(m.reviewer_comments)}</div>` : ''}
            </td>
          </tr>
        `).join('')}
        ${(gr.meta?.tactics || []).map(t => `
          <tr>
            <td colspan="8" style="padding-left:26px;padding-top:6px;padding-bottom:6px;border-top:1px dashed var(--border)">
              <span style="font-size:12.5px">⚡ ${esc(t.tactic_title)}</span>
              <span class="pill neutral" style="margin-left:6px;font-size:10.5px">${FREQ_LABEL[t.frequency] || t.frequency}</span>
              <span id="tactic-stat-${t.tactic_id}" data-tactic="${t.tactic_id}" data-freq="${t.frequency}" style="margin-left:10px">
                <span class="text-dim" style="font-size:11.5px">กำลังโหลด...</span>
              </span>
            </td>
          </tr>
        `).join('')}
      `;
      }).join('')}
    </tbody>
  </table>
  <div class="flex" style="justify-content:flex-end;margin-top:14px">
    <button class="btn btn-primary" id="save-month-btn">บันทึกผลงานจริงเดือนนี้</button>
  </div>`;

  document.getElementById('save-month-btn').onclick = saveMonth;
  wrap.querySelectorAll('[id^="tactic-stat-"]').forEach(el => loadTacticStat(el));
}

// ============================================================================
// สถานะทีเด็ดใต้เป้าหมายแต่ละอัน (แสดงในตาราง Scoreboard โดยตรง) — จุดสีต่องวด
// ที่ตกอยู่ในเดือนที่กำลังดู พร้อม "% เทียบแผน" = จำนวนงวดที่ทำแล้ว / งวดทั้งหมด
// ที่ควรรายงานในเดือนนั้นตามความถี่ (คำนวณจาก periodsInMonth)
// ============================================================================
async function loadTacticStat(el) {
  const tacticId = Number(el.dataset.tactic);
  const freq = el.dataset.freq;
  const periods = periodsInMonth(freq, CURRENT_YEAR_CE, selectedMonth);
  let checkins = [];
  if (periods.length) {
    try { checkins = await api.listTacticCheckins(tacticId, periods[0], periods[periods.length - 1]); } catch { checkins = []; }
  }
  const byDate = new Map(checkins.map(c => [c.period_date, c.done]));
  const doneCount = checkins.filter(c => c.done).length;
  const pct = periods.length ? Math.round((doneCount / periods.length) * 100) : null;
  const pctColor = pct == null ? 'var(--text-dim)' : pct >= 100 ? 'var(--green)' : pct >= 50 ? 'var(--amber)' : 'var(--red)';

  const dotsHtml = periods.map(p => {
    const done = byDate.has(p) ? byDate.get(p) : null;
    const color = done === true ? 'var(--green)' : done === false ? 'var(--red)' : 'var(--border)';
    return `<span title="${p}" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${color}"></span>`;
  }).join('');

  el.innerHTML = `
    <span class="flex gap-4" style="display:inline-flex;vertical-align:middle">${dotsHtml}</span>
    <strong style="margin-left:8px;font-size:12px;color:${pctColor}">${pct != null ? pct + '% เทียบแผน' : 'ไม่มีงวดในเดือนนี้'}</strong>
  `;
}

function openScoreboardImportModal() {
  const goals = [...goalMeta.values()];
  if (!goals.length) { toast('ยังไม่มีเป้าหมายในปีนี้ กรุณาไปที่หน้า "เป้าหมาย & ทีเด็ด" ก่อน', 'error'); return; }
  const editableGoals = goals.filter(g => !g.is_shared && g.metrics.length); // ถือเป้าร่วม แก้จากที่นี่ไม่ได้ (อ่านอย่างเดียว)
  const headers = ['ชื่อเป้าหมาย', ...MONTHS_TH];
  const blankRows = editableGoals.map(g => [g.goal_title, ...Array(12).fill('')]);
  openPasteImportModal({
    title: '📋 นำเข้าผลงานจริงทั้งปีจาก Excel / Google Sheet',
    instructions: `นำเข้าผลงานจริงของ "${viewingUserId === ctx.user.user_id ? 'ตัวเอง' : 'ลูกน้องที่กำลังดูอยู่'}" ปี ${CURRENT_YEAR_CE + 543} — กรอกได้ทั้ง 12 เดือนพร้อมกัน คอลัมน์ที่เว้นว่างไว้จะไม่ถูกแตะต้อง (ค่าเดิมยังอยู่) นำเข้าได้เฉพาะ "ตัววัดหลักตัวแรก" ของแต่ละเป้าหมายเท่านั้น ตัววัดอื่นกรอกในตารางด้านบนเอง`,
    headers, blankRows, filename: 'scoreboard_template.csv',
    onImport: async (rows) => {
      let ok = 0, fail = 0, skip = 0;
      for (const r of rows) {
        const [title, ...monthVals] = r;
        if (!title || !title.trim()) continue;
        const g = editableGoals.find(g => g.goal_title.trim() === title.trim());
        if (!g || !g.metrics[0]) { skip++; continue; }
        const metricId = g.metrics[0].metric_id;
        for (let i = 0; i < 12; i++) {
          const v = (monthVals[i] || '').trim();
          if (v === '') continue;
          const n = Number(v);
          if (Number.isNaN(n)) { fail++; continue; }
          try {
            await api.upsertScoreboard({ metric_id: metricId, month_num: i + 1, actual_val: n });
            ok++;
          } catch { fail++; }
        }
      }
      await loadData();
      return { ok, fail, skip };
    },
  });
}

async function saveMonth() {
  const btn = document.getElementById('save-month-btn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> กำลังบันทึก...';
  try {
    const metricIds = [...new Set(scoreData.filter(r => r.month_num === selectedMonth).map(r => r.metric_id))];
    for (const mid of metricIds) {
      const input = document.querySelector(`[data-actual="${mid}"]`);
      if (!input) continue; // ถือเป้าร่วม (read-only) — ไม่มีช่องกรอกให้บันทึก
      const a = input.value;
      await api.upsertScoreboard({
        metric_id: mid, month_num: selectedMonth,
        actual_val: a === '' ? null : Number(a),
      });
    }
    toast('บันทึกข้อมูลเดือน ' + MONTHS_TH[selectedMonth - 1] + ' เรียบร้อย');
    await loadData();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'บันทึกผลงานจริงเดือนนี้';
  }
}

async function submitMonth() {
  if (viewingUserId !== ctx.user.user_id) {
    toast('การส่งรายงานต้องทำโดยเจ้าของข้อมูลเอง สลับกลับไปที่ "ของฉันเอง" ก่อน', 'error');
    return;
  }
  try {
    const n = await api.submitMonthlyReport(CURRENT_YEAR_CE, selectedMonth);
    toast(n > 0 ? `ส่งรายงานเดือน ${MONTHS_TH[selectedMonth - 1]} เรียบร้อย (${n} รายการ)` : 'ไม่มีรายการที่ต้องส่ง (อาจอนุมัติแล้ว หรือยังไม่มีข้อมูล)');
    await loadData();
  } catch (err) {
    toast(err.message, 'error');
  }
}
