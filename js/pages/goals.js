import { api } from '../api.js';
import { toast, openModal, closeModal, confirmDialog, escapeHtml as esc, OPERATOR_SYMBOL, OPERATOR_LABEL_TH } from '../ui.js';
import { CURRENT_YEAR_CE } from '../config.js';
import { openPasteImportModal } from '../pasteImport.js';
import { FREQ_LABEL, currentPeriodDate, stepPeriod, periodLabel } from '../tacticPeriods.js';

let ctx; // { user }
let viewingUserId;
let subordinates = [];
let currentGoals = [];

export async function render(container, context) {
  ctx = context;
  viewingUserId = context.user.user_id;

  if (context.user.role !== 'STAFF') {
    try { subordinates = await api.getSubordinates(); } catch { subordinates = []; }
  }

  container.innerHTML = `
    <div class="flex-between mb-16">
      <div class="flex gap-12">
        ${subordinates.length ? `
          <select id="viewer-select" style="width:260px">
            <option value="${context.user.user_id}">🙋 ของฉันเอง (${esc(context.user.first_name)})</option>
            ${subordinates.map(s => `<option value="${s.user_id}">${esc(s.first_name)} ${esc(s.last_name)} — ${esc(s.position_title)}</option>`).join('')}
          </select>
        ` : ''}
      </div>
      <div class="flex gap-8">
        <button class="btn btn-sm" id="import-goals-btn">📋 นำเข้าเป้าหมาย</button>
        <button class="btn btn-sm" id="import-tactics-btn">📋 นำเข้าทีเด็ด</button>
        <button class="btn btn-primary" id="add-goal-btn">+ เพิ่มเป้าหมาย</button>
      </div>
    </div>

    <div id="goals-list"></div>

    ${subordinates.length ? `
      <div class="card mt-24">
        <div class="card-title">🤝 ถือเป้าร่วมกับลูกน้อง</div>
        <p class="text-muted" style="margin:-4px 0 12px;font-size:13px">
          เมื่อถือเป้าร่วม เป้าหมายจะปรากฏในรายการของคุณ (ด้านบน แบบอ่านอย่างเดียว) โดยข้อมูลทั้งหมด — ทีเด็ด และผลบันทึก Scoreboard — จะดึงมาจากสิ่งที่ลูกน้องกรอกเท่านั้น ไม่มีการคัดลอกหรือกรอกซ้ำ
        </p>
        <div id="adopt-panel"></div>
      </div>
    ` : ''}
  `;

  document.getElementById('add-goal-btn').onclick = () => openGoalModal(null);
  document.getElementById('import-goals-btn').onclick = () => openGoalsImportModal();
  document.getElementById('import-tactics-btn').onclick = () => openTacticsImportModal();
  const viewerSelect = document.getElementById('viewer-select');
  if (viewerSelect) viewerSelect.onchange = async (e) => {
    viewingUserId = Number(e.target.value);
    await loadGoals(container);
  };

  await loadGoals(container);
  if (subordinates.length) await loadAdoptPanel();
}

async function loadGoals(container) {
  const list = document.getElementById('goals-list');
  list.innerHTML = `<div class="loading-page"><span class="spinner"></span></div>`;
  currentGoals = await api.listGoals(viewingUserId, CURRENT_YEAR_CE);

  if (!currentGoals.length) {
    list.innerHTML = `<div class="card"><div class="empty-state"><div class="icon">🎯</div>ยังไม่มีเป้าหมายในปีนี้ กด "+ เพิ่มเป้าหมาย" เพื่อเริ่มต้น</div></div>`;
    return;
  }

  list.innerHTML = currentGoals.map(g => `
    <div class="card" ${g.is_shared ? 'style="border-color:var(--amber)"' : ''}>
      <div class="flex-between">
        <div>
          <strong style="font-size:15.5px">${esc(g.goal_title)}</strong>
          ${g.is_shared ? `<span class="pill yellow" style="margin-left:8px"><span class="dot"></span>ถือร่วมกับ ${esc(g.owner_name)}</span>` : ''}
          <div class="text-muted" style="font-size:13px;margin-top:2px">น้ำหนัก: ${g.weight_percentage ?? '-'}%</div>
        </div>
        <div class="flex gap-8">
          ${g.is_shared ? `
            <button class="btn btn-sm btn-ghost" data-release-goal="${g.goal_id}">เลิกถือร่วม</button>
          ` : `
            <button class="btn btn-sm" data-edit-goal="${g.goal_id}">แก้ไขชื่อ/น้ำหนัก</button>
            <button class="btn btn-sm btn-danger" data-del-goal="${g.goal_id}">ลบ</button>
          `}
        </div>
      </div>

      <div class="mt-16">
        <div class="flex-between mb-8">
          <span class="text-muted" style="font-size:13px">ตัววัด (${g.metrics.length}) — ถ้ามีมากกว่า 1 ตัว ตัวที่ "แย่ที่สุด" ในแต่ละเดือนจะเป็นตัวชี้ขาดว่าเป้าหมายผ่านหรือไม่</span>
          ${g.is_shared ? '' : `<button class="btn btn-sm" data-add-metric="${g.goal_id}">+ เพิ่มตัววัด</button>`}
        </div>
        ${g.metrics.map(m => `
          <div class="flex-between" style="padding:6px 0;border-top:1px solid var(--border);font-size:13.5px">
            <div>${esc(m.metric_unit || '-')} · เป้าหมาย: <strong>${OPERATOR_SYMBOL[m.evaluation_operator] || '≥'} ${m.target_value ?? '-'}</strong></div>
            ${g.is_shared ? '' : `
              <div class="flex gap-8">
                <button class="btn btn-sm" data-edit-metric="${m.metric_id}" data-goal="${g.goal_id}">แก้ไข</button>
                ${g.metrics.length > 1 ? `<button class="btn btn-sm btn-danger" data-del-metric="${m.metric_id}">ลบ</button>` : ''}
              </div>
            `}
          </div>
        `).join('') || '<div class="text-dim" style="font-size:13px;padding:6px 0">ยังไม่มีตัววัด</div>'}
      </div>

      <div class="mt-16">
        <div class="flex-between mb-8">
          <span class="text-muted" style="font-size:13px">ทีเด็ด (${g.tactics.length})</span>
          ${g.is_shared ? '' : `<button class="btn btn-sm" data-add-tactic="${g.goal_id}">+ เพิ่มทีเด็ด</button>`}
        </div>
        ${g.tactics.map(t => `
          <div style="padding:8px 0;border-top:1px solid var(--border)">
            <div class="flex-between">
              <div>
                <div>${esc(t.tactic_title)} <span class="pill neutral" style="margin-left:6px;font-size:11px">${FREQ_LABEL[t.frequency] || t.frequency}</span></div>
                ${t.action_plan_description ? `<div class="text-dim" style="font-size:12.5px">${esc(t.action_plan_description)}</div>` : ''}
              </div>
              ${g.is_shared ? '' : `
                <div class="flex gap-8">
                  <button class="btn btn-sm" data-edit-tactic='${t.tactic_id}' data-goal="${g.goal_id}">แก้ไข</button>
                  <button class="btn btn-sm btn-danger" data-del-tactic="${t.tactic_id}">ลบ</button>
                </div>
              `}
            </div>
            <div id="checkin-${t.tactic_id}" class="mt-8" data-tactic="${t.tactic_id}" data-freq="${t.frequency}" data-shared="${g.is_shared}">
              <span class="text-dim" style="font-size:12px">กำลังโหลดสถานะรายงาน...</span>
            </div>
          </div>
        `).join('') || '<div class="text-dim" style="font-size:13px;padding:6px 0">ยังไม่มีทีเด็ด</div>'}
      </div>
    </div>
  `).join('');

  list.querySelectorAll('[data-edit-goal]').forEach(b => b.onclick = () => openGoalModal(currentGoals.find(g => g.goal_id == b.dataset.editGoal)));
  list.querySelectorAll('[data-del-goal]').forEach(b => b.onclick = () => deleteGoal(b.dataset.delGoal, container));
  list.querySelectorAll('[data-release-goal]').forEach(b => b.onclick = () => releaseGoal(b.dataset.releaseGoal, container));
  list.querySelectorAll('[data-add-metric]').forEach(b => b.onclick = () => openMetricModal(b.dataset.addMetric, null));
  list.querySelectorAll('[data-edit-metric]').forEach(b => {
    const g = currentGoals.find(g => g.goal_id == b.dataset.goal);
    const m = g.metrics.find(m => m.metric_id == b.dataset.editMetric);
    b.onclick = () => openMetricModal(b.dataset.goal, m);
  });
  list.querySelectorAll('[data-del-metric]').forEach(b => b.onclick = () => deleteMetric(b.dataset.delMetric, container));
  list.querySelectorAll('[data-add-tactic]').forEach(b => b.onclick = () => openTacticModal(b.dataset.addTactic, null));
  list.querySelectorAll('[data-edit-tactic]').forEach(b => b.onclick = () => {
    const g = currentGoals.find(g => g.goal_id == b.dataset.goal);
    const t = g.tactics.find(t => t.tactic_id == b.dataset.editTactic);
    openTacticModal(b.dataset.goal, t);
  });
  list.querySelectorAll('[data-del-tactic]').forEach(b => b.onclick = () => deleteTactic(b.dataset.delTactic, container));

  list.querySelectorAll('[id^="checkin-"]').forEach(el => loadCheckinWidget(el));
}

function openGoalModal(goal) {
  const backdrop = openModal(`
    <h3 style="margin-top:0">${goal ? 'แก้ไขเป้าหมาย' : 'เพิ่มเป้าหมายใหม่'}</h3>
    <div class="field"><label>ชื่อเป้าหมาย</label><input id="f-title" value="${esc(goal?.goal_title || '')}"></div>
    <div class="field"><label>น้ำหนัก (%)</label><input id="f-weight" type="number" step="0.01" value="${goal?.weight_percentage ?? ''}"></div>
    ${!goal ? `<div class="hint-box">เพิ่มตัววัดแรกได้หลังบันทึกเป้าหมายนี้แล้ว จากปุ่ม "+ เพิ่มตัววัด" ในการ์ดเป้าหมาย</div>` : ''}
    <div class="flex gap-8" style="justify-content:flex-end;margin-top:14px">
      <button class="btn" id="cancel-btn">ยกเลิก</button>
      <button class="btn btn-primary" id="save-btn">บันทึก</button>
    </div>
  `);
  backdrop.querySelector('#cancel-btn').onclick = () => closeModal(backdrop);
  backdrop.querySelector('#save-btn').onclick = async () => {
    try {
      const title = backdrop.querySelector('#f-title').value.trim();
      if (!title) { toast('กรุณากรอกชื่อเป้าหมาย', 'error'); return; }
      const newGoalId = await api.upsertGoal({
        goal_id: goal?.goal_id ?? null, target_user_id: viewingUserId, goal_title: title,
        weight_percentage: numOrNull(backdrop.querySelector('#f-weight').value),
        year: CURRENT_YEAR_CE, parent_goal_id: goal?.parent_goal_id ?? null,
      });
      if (!goal) {
        const metricId = await api.upsertGoalMetric({ goal_id: newGoalId, metric_unit: '', target_value: null, evaluation_operator: 'GTE', sort_order: 0 });
        closeModal(backdrop);
        await loadGoals(document);
        openMetricModal(newGoalId, { metric_id: metricId, metric_unit: '', target_value: null, evaluation_operator: 'GTE' });
        return;
      }
      closeModal(backdrop);
      toast('บันทึกเป้าหมายเรียบร้อย');
      await loadGoals(document);
    } catch (err) { toast(err.message, 'error'); }
  };
}

function openMetricModal(goalId, metric) {
  const backdrop = openModal(`
    <h3 style="margin-top:0">${metric?.metric_id ? 'แก้ไขตัววัด' : 'เพิ่มตัววัดใหม่'}</h3>
    <div class="field-row">
      <div class="field"><label>ตัวชี้วัด (หน่วย)</label><input id="f-unit" value="${esc(metric?.metric_unit || '')}"></div>
      <div class="field"><label>ค่าเป้าหมาย</label><input id="f-target" type="number" step="0.01" value="${metric?.target_value ?? ''}"></div>
    </div>
    <div class="field">
      <label>เงื่อนไขบรรลุเป้า (ผลจริง [เงื่อนไข] ค่าเป้าหมาย)</label>
      <select id="f-operator">
        ${Object.entries(OPERATOR_LABEL_TH).map(([k, v]) => `<option value="${k}" ${(metric?.evaluation_operator || 'GTE') === k ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
      <div class="text-dim" style="font-size:11.5px;margin-top:4px">เช่น เป้าลดของเสีย/ลดเวลาเครื่องเสีย ให้เลือก "น้อยกว่าหรือเท่ากับ" เพราะยิ่งน้อยยิ่งดี</div>
    </div>
    <div class="flex gap-8" style="justify-content:flex-end">
      <button class="btn" id="cancel-btn">ยกเลิก</button>
      <button class="btn btn-primary" id="save-btn">บันทึก</button>
    </div>
  `);
  backdrop.querySelector('#cancel-btn').onclick = () => closeModal(backdrop);
  backdrop.querySelector('#save-btn').onclick = async () => {
    try {
      await api.upsertGoalMetric({
        metric_id: metric?.metric_id ?? null, goal_id: goalId,
        metric_unit: backdrop.querySelector('#f-unit').value.trim(),
        target_value: numOrNull(backdrop.querySelector('#f-target').value),
        evaluation_operator: backdrop.querySelector('#f-operator').value,
      });
      closeModal(backdrop);
      toast('บันทึกตัววัดเรียบร้อย');
      await loadGoals(document);
    } catch (err) { toast(err.message, 'error'); }
  };
}

function openTacticModal(goalId, tactic) {
  const backdrop = openModal(`
    <h3 style="margin-top:0">${tactic ? 'แก้ไขทีเด็ด' : 'เพิ่มทีเด็ดใหม่'}</h3>
    <div class="field"><label>ชื่อทีเด็ด</label><input id="f-title" value="${esc(tactic?.tactic_title || '')}"></div>
    <div class="field"><label>รายละเอียดแผนปฏิบัติการ</label><textarea id="f-desc" rows="3">${esc(tactic?.action_plan_description || '')}</textarea></div>
    <div class="field">
      <label>ความถี่ในการรายงาน (ทำ/ไม่ทำ)</label>
      <select id="f-freq">
        ${Object.entries(FREQ_LABEL).map(([k, v]) => `<option value="${k}" ${(tactic?.frequency || 'WEEKLY') === k ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
    </div>
    <div class="flex gap-8" style="justify-content:flex-end">
      <button class="btn" id="cancel-btn">ยกเลิก</button>
      <button class="btn btn-primary" id="save-btn">บันทึก</button>
    </div>
  `);
  backdrop.querySelector('#cancel-btn').onclick = () => closeModal(backdrop);
  backdrop.querySelector('#save-btn').onclick = async () => {
    try {
      await api.upsertTactic({
        tactic_id: tactic?.tactic_id ?? null, goal_id: goalId,
        tactic_title: backdrop.querySelector('#f-title').value.trim(),
        action_plan_description: backdrop.querySelector('#f-desc').value.trim(),
        frequency: backdrop.querySelector('#f-freq').value,
      });
      closeModal(backdrop);
      toast('บันทึกทีเด็ดเรียบร้อย');
      await loadGoals(document);
    } catch (err) { toast(err.message, 'error'); }
  };
}

// ============================================================================
// Check-in ทีเด็ด — รายงาน "ทำ/ไม่ทำ" ตามความถี่ที่ตั้งไว้ (รายวัน/สัปดาห์/เดือน)
// คลิกจุดในแถบประวัติเพื่อ "ย้อนหลังกรอก" งวดเก่าได้ เหมือนหน้า Scoreboard ที่
// เลือกเดือนย้อนหลังกรอกได้ ไม่ได้บังคับกรอกแค่งวดปัจจุบันงวดเดียว
// ============================================================================
async function loadCheckinWidget(el, selectedPeriod) {
  const tacticId = Number(el.dataset.tactic);
  const freq = el.dataset.freq;
  const isShared = el.dataset.shared === 'true';
  const nowPeriod = currentPeriodDate(freq);
  selectedPeriod = selectedPeriod || nowPeriod;
  // ดูย้อนหลัง 12 งวดล่าสุด (รวมงวดปัจจุบัน) ให้คลิกย้อนกรอกได้
  const periods = Array.from({ length: 12 }, (_, i) => stepPeriod(nowPeriod, freq, -(11 - i)));
  let rows = [];
  try { rows = await api.listTacticCheckins(tacticId, periods[0], nowPeriod); } catch { rows = []; }
  const byDate = new Map(rows.map(r => [r.period_date, r.done]));

  const dotsHtml = periods.map(p => {
    const done = byDate.has(p) ? byDate.get(p) : null;
    const color = done === true ? 'var(--green)' : done === false ? 'var(--red)' : 'var(--border)';
    const ring = p === selectedPeriod ? 'outline:2px solid var(--accent);outline-offset:1px' : '';
    return `<button type="button" data-period="${p}" title="${periodLabel(p, freq)}" style="width:12px;height:12px;padding:0;border:none;border-radius:50%;background:${color};cursor:pointer;${ring}"></button>`;
  }).join('');

  const curDone = byDate.has(selectedPeriod) ? byDate.get(selectedPeriod) : null;
  el.innerHTML = `
    <div class="flex gap-8" style="align-items:center;flex-wrap:wrap">
      <span class="text-dim" style="font-size:11px">12 งวดล่าสุด (คลิกจุดเพื่อย้อนหลังกรอก):</span>
      <span class="flex gap-4">${dotsHtml}</span>
    </div>
    <div class="flex gap-8" style="align-items:center;margin-top:6px;flex-wrap:wrap">
      <span class="text-dim" style="font-size:11px">งวดที่เลือก (${periodLabel(selectedPeriod, freq)}${selectedPeriod === nowPeriod ? ' · งวดนี้' : ''}):</span>
      ${isShared ? `
        <span class="text-dim" style="font-size:12px">${curDone === true ? '✓ ทำแล้ว' : curDone === false ? '✗ ยังไม่ทำ' : 'ยังไม่รายงาน'}</span>
      ` : `
        <button class="btn btn-sm ${curDone === true ? 'btn-primary' : ''}" data-checkin-done="1">✓ ทำแล้ว</button>
        <button class="btn btn-sm ${curDone === false ? 'btn-danger' : ''}" data-checkin-done="0">✗ ยังไม่ทำ</button>
      `}
    </div>
  `;
  el.querySelectorAll('[data-period]').forEach(b => b.onclick = () => loadCheckinWidget(el, b.dataset.period));
  if (isShared) return;
  el.querySelectorAll('[data-checkin-done]').forEach(b => b.onclick = async () => {
    try {
      await api.checkinTactic({ tactic_id: tacticId, period_date: selectedPeriod, done: b.dataset.checkinDone === '1' });
      await loadCheckinWidget(el, selectedPeriod);
    } catch (err) { toast(err.message, 'error'); }
  });
}


function openGoalsImportModal() {
  const headers = ['ชื่อเป้าหมาย', 'หน่วยวัด (ตัววัดหลัก)', 'ค่าเป้าหมาย', 'น้ำหนัก(%)', 'เงื่อนไข(>,>=,<,<=,=)'];
  const blankRows = currentGoals.map(g => {
    const m0 = g.metrics[0] || {};
    return [g.goal_title, m0.metric_unit || '', m0.target_value ?? '', g.weight_percentage ?? '', OPERATOR_SYMBOL[m0.evaluation_operator] || '≥'];
  });
  openPasteImportModal({
    title: '📋 นำเข้าเป้าหมายจาก Excel / Google Sheet',
    instructions: `นำเข้าให้ "${viewingUserId === ctx.user.user_id ? 'ตัวเอง' : 'ลูกน้องที่กำลังดูอยู่'}" ปี ${CURRENT_YEAR_CE + 543} — จับคู่ด้วยชื่อเป้าหมายเพื่ออัปเดตทับ (สร้างใหม่ถ้าไม่พบ) นำเข้าได้เฉพาะ "ตัววัดหลักตัวแรก" เท่านั้น ตัววัดเพิ่มเติมให้เพิ่มเองในฟอร์มเป้าหมายทีหลัง`,
    headers, blankRows, filename: 'goals_template.csv',
    onImport: async (rows) => {
      let ok = 0, fail = 0;
      for (const r of rows) {
        const [title, unit, target, weight, opRaw] = r;
        if (!title || !title.trim()) continue;
        const existing = currentGoals.find(g => g.goal_title.trim() === title.trim());
        try {
          const goalId = await api.upsertGoal({
            goal_id: existing?.goal_id ?? null, target_user_id: viewingUserId,
            goal_title: title.trim(), weight_percentage: numOrNull(weight),
            year: CURRENT_YEAR_CE, parent_goal_id: existing?.parent_goal_id ?? null,
          });
          const m0 = existing?.metrics?.[0];
          await api.upsertGoalMetric({
            metric_id: m0?.metric_id ?? null, goal_id: goalId,
            metric_unit: (unit || '').trim(), target_value: numOrNull(target),
            evaluation_operator: parseOperatorInput(opRaw), sort_order: 0,
          });
          ok++;
        } catch { fail++; }
      }
      await loadGoals(document);
      return { ok, fail, total: rows.length };
    },
  });
}

function openTacticsImportModal() {
  if (!currentGoals.length) { toast('กรุณาเพิ่มเป้าหมายอย่างน้อย 1 รายการก่อนนำเข้าทีเด็ด', 'error'); return; }
  const headers = ['ชื่อเป้าหมายที่แนบ', 'ชื่อทีเด็ด', 'แผนปฏิบัติการ', 'ความถี่(รายวัน/รายสัปดาห์/รายเดือน)'];
  const blankRows = currentGoals.filter(g => !g.is_shared).map(g => [g.goal_title, '', '', 'รายสัปดาห์']);
  openPasteImportModal({
    title: '📋 นำเข้าทีเด็ดจาก Excel / Google Sheet',
    instructions: 'คอลัมน์แรกต้องพิมพ์ชื่อเป้าหมายให้ตรงกับที่มีอยู่แล้วเป๊ะๆ (ระบบจะจับคู่ให้อัตโนมัติ) แถวที่ไม่พบเป้าหมายที่ตรงกันจะถูกข้าม ความถี่ถ้าเว้นว่างหรืออ่านไม่ออกจะใช้ "รายสัปดาห์" เป็นค่าเริ่มต้น',
    headers, blankRows, filename: 'tactics_template.csv',
    onImport: async (rows) => {
      let ok = 0, fail = 0, skip = 0;
      for (const r of rows) {
        const [goalTitle, tacticTitle, desc, freqRaw] = r;
        if (!tacticTitle || !tacticTitle.trim()) continue;
        const g = currentGoals.find(g => g.goal_title.trim() === (goalTitle || '').trim());
        if (!g) { skip++; continue; }
        try {
          await api.upsertTactic({
            tactic_id: null, goal_id: g.goal_id,
            tactic_title: tacticTitle.trim(), action_plan_description: (desc || '').trim(),
            frequency: parseFrequencyInput(freqRaw),
          });
          ok++;
        } catch { fail++; }
      }
      await loadGoals(document);
      return { ok, fail, skip, total: rows.length };
    },
  });
}

function parseOperatorInput(raw) {
  const s = (raw || '').trim();
  const symMap = { '>': 'GT', '>=': 'GTE', '≥': 'GTE', '<': 'LT', '<=': 'LTE', '≤': 'LTE', '=': 'EQ' };
  if (symMap[s]) return symMap[s];
  const found = Object.entries(OPERATOR_LABEL_TH).find(([, label]) => label === s);
  return found ? found[0] : 'GTE';
}
function parseFrequencyInput(raw) {
  const s = (raw || '').trim();
  const found = Object.entries(FREQ_LABEL).find(([k, v]) => v === s || k === s.toUpperCase());
  return found ? found[0] : 'WEEKLY';
}

async function deleteGoal(goalId, container) {
  if (!(await confirmDialog('ต้องการลบเป้าหมายนี้ใช่หรือไม่? ทีเด็ดภายใต้เป้าหมายนี้จะถูกลบไปด้วย'))) return;
  try { await api.deleteGoal(goalId); toast('ลบเป้าหมายแล้ว'); await loadGoals(container); }
  catch (err) { toast(err.message, 'error'); }
}
async function deleteMetric(metricId, container) {
  if (!(await confirmDialog('ต้องการลบตัววัดนี้ใช่หรือไม่?'))) return;
  try { await api.deleteGoalMetric(metricId); toast('ลบตัววัดแล้ว'); await loadGoals(container); }
  catch (err) { toast(err.message, 'error'); }
}
async function deleteTactic(tacticId, container) {
  if (!(await confirmDialog('ต้องการลบทีเด็ดนี้ใช่หรือไม่?'))) return;
  try { await api.deleteTactic(tacticId); toast('ลบทีเด็ดแล้ว'); await loadGoals(container); }
  catch (err) { toast(err.message, 'error'); }
}
async function releaseGoal(goalId, container) {
  if (!(await confirmDialog('เลิกถือเป้าร่วมนี้ใช่หรือไม่? (เป้าหมายจริงของลูกน้องจะยังอยู่ตามเดิม แค่จะไม่แสดงในรายการของคุณอีก)'))) return;
  try { await api.releaseSharedGoal(goalId); toast('เลิกถือเป้าร่วมแล้ว'); await loadGoals(container); }
  catch (err) { toast(err.message, 'error'); }
}

async function loadAdoptPanel() {
  const panel = document.getElementById('adopt-panel');
  panel.innerHTML = `<div class="loading-page"><span class="spinner"></span></div>`;

  const rows = await Promise.all(subordinates.map(async s => ({
    sub: s, goals: await api.listGoals(s.user_id, CURRENT_YEAR_CE),
  })));

  const heldGoalIds = new Set(currentGoals.filter(g => g.is_shared).map(g => g.goal_id));
  const items = [];
  rows.forEach(({ sub, goals }) => goals
    .filter(g => !g.is_shared && !heldGoalIds.has(g.goal_id))
    .forEach(g => items.push({ goal_id: g.goal_id, title: g.goal_title, tactics_count: g.tactics.length, owner: sub })));

  if (!items.length) {
    panel.innerHTML = `<div class="empty-state"><div class="icon">🤝</div>ไม่มีเป้าหมายของลูกน้องให้ถือร่วมเพิ่มแล้ว</div>`;
    return;
  }

  panel.innerHTML = `<table><thead><tr>
    <th>เป้าหมาย</th><th>เจ้าของ</th><th>ทีเด็ด</th><th></th>
  </tr></thead><tbody>
    ${items.map(it => `
      <tr>
        <td>${esc(it.title)}</td>
        <td class="text-muted">${esc(it.owner.first_name)} ${esc(it.owner.last_name)}</td>
        <td class="text-muted">${it.tactics_count}</td>
        <td><button class="btn btn-sm" data-hold="${it.goal_id}">ถือเป้าร่วม</button></td>
      </tr>
    `).join('')}
  </tbody></table>`;

  panel.querySelectorAll('[data-hold]').forEach(b => b.onclick = () => holdGoal(Number(b.dataset.hold)));
}

async function holdGoal(goalId) {
  try {
    await api.holdSharedGoal(goalId);
    toast('ถือเป้าร่วมเรียบร้อย');
    await loadGoals(document);
    await loadAdoptPanel();
  } catch (err) { toast(err.message, 'error'); }
}

function numOrNull(v) { return v === '' || v === null || v === undefined ? null : Number(v); }
