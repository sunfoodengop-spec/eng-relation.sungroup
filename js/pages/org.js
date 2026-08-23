import { api } from '../api.js';
import { toast, openModal, closeModal, confirmDialog, MONTHS_TH, escapeHtml as esc, OPERATOR_SYMBOL, OPERATOR_LABEL_TH } from '../ui.js';
import { CURRENT_YEAR_CE } from '../config.js';

const LEVELS = [80, 75, 65, 55, 40]; // บนสุด -> ล่างสุด
const LEVEL_LABEL = { 95: 'ผู้บริหาร', 85: 'GM', 75: 'ผจก.ฝ่าย', 65: 'ผจก.ส่วน', 55: 'ผจก.แผนก', 40: 'จนท.' };
const TOP_LEVEL_THRESHOLD = 80; // ระดับตั้งแต่นี้ขึ้นไปไม่มีแผนก จะวาดเป็นแถวคานกลางเหนือ Matrix

// ⚠️ CUSTOMIZE PER PROJECT: จัดกลุ่มแผนกย่อยเข้าเป็นสายงานหลักตาม Org Chart
// ที่ได้รับมา — แก้ไข key/label/match ให้ตรงกับฝ่ายจริงของบริษัทนี้
// (ดูวิธีแปลง Org Chart เป็นค่านี้ใน references/org_chart_parsing.md ของ Skill)
//
// ลำดับคอลัมน์ (ซ้าย->ขวา) ยืนยันแล้ว: LMN1 | LMN2 | RD | OP | SRN | ENF |
// Prod_SRN | พลังงาน | ASRS — คนที่คุมมากกว่า 1 แผนก (เช่น อัษฎาวุธ คุม OP+SRN+ENF,
// เพียว คุม OP+SRN, บั๊กโจ้ คุม พลังงาน+ASRS) ต้องมีแผนกที่ตัวเองคุมเรียงติดกัน
// ในลำดับนี้เสมอ ไม่งั้นการ "วาง Block ตรงกลาง" จะดูผิดเพี้ยน
const DEPT_GROUPS = [
  { key: 'LMN1', label: 'LMN1', match: ['LMN1'] },
  { key: 'LMN2', label: 'LMN2', match: ['LMN2'] },
  { key: 'RD', label: 'RD', match: ['RD'] },
  { key: 'OP', label: 'OP', match: ['OP'] },
  { key: 'SRN', label: 'SRN', match: ['SRN'] },
  { key: 'ENF', label: 'ENF', match: ['ENF'] },
  { key: 'PROD_SRN', label: 'Prod SRN', match: ['Prod SRN'] },
  { key: 'ENE', label: 'พลังงาน', match: ['พลังงาน'] },
  { key: 'ASRS', label: 'ASRS', match: ['ASRS'] },
  // key ควรสั้นไม่มีช่องว่าง, match คือ department string ทุกค่าที่พบใน
  // seed_org.sql ที่ควรถูกจัดเข้ากลุ่มคอลัมน์นี้
];
function groupOf(dept) {
  if (!dept) return null;
  const g = DEPT_GROUPS.find(g => g.match.includes(dept));
  return g ? g.key : 'อื่นๆ';
}
// คนที่คุมมากกว่า 1 แผนก: department ใน seed SQL ใส่เป็น raw tag คั่นด้วย comma
// เช่น 'OP,SRN,ENF' — deptKeysOf คืนค่าเป็น array ของ column key ทั้งหมดที่ match
// (ความยาว > 1 = ต้องวาง Block ตรงกลางคร่อมทุกคอลัมน์ที่ match, ดู renderMatrixRow)
function deptKeysOf(dept) {
  if (!dept) return [];
  return dept.split(',').map(s => s.trim()).filter(Boolean).map(tag => {
    const g = DEPT_GROUPS.find(g => g.match.includes(tag));
    return g ? g.key : 'อื่นๆ';
  });
}

// ---- Layout constants (px) -------------------------------------------------
const CARD_W = 172, CARD_H = 62, CARD_GAP_Y = 12, COL_GAP = 30, ROW_GAP = 60;
const HEADER_H = 30, TOP_MARGIN = 16, LEFT_MARGIN = 70;

let allPeople = [];
let byId = new Map();
let currentUser = null;
let subordinateIds = new Set(); // สำหรับ SUPERVISOR เช็คสิทธิ์ลบ (Admin ไม่ต้องเช็ค)
let lastContainer = null;

export async function render(container, ctx) {
  currentUser = ctx.user;
  lastContainer = container;
  container.innerHTML = `<div class="loading-page"><span class="spinner"></span></div>`;

  allPeople = await api.getOrgChart();
  if (!allPeople.length) {
    container.innerHTML = `<div class="card"><div class="empty-state"><div class="icon">🕸️</div>ไม่มีข้อมูลผังองค์กรที่คุณมีสิทธิ์เห็น</div></div>`;
    return;
  }
  byId = new Map(allPeople.map(p => [p.user_id, p]));

  subordinateIds = new Set();
  if (currentUser.role === 'SUPERVISOR') {
    try { (await api.getSubordinates()).forEach(s => subordinateIds.add(s.user_id)); } catch { /* ignore */ }
  }

  const topPeople = allPeople.filter(p => p.org_level >= TOP_LEVEL_THRESHOLD);
  const rest = allPeople.filter(p => p.org_level < TOP_LEVEL_THRESHOLD);
  const topLevelsPresent = [...new Set(topPeople.map(p => p.org_level))].sort((a, b) => b - a);

  const columns = DEPT_GROUPS.filter(g => rest.some(p => deptKeysOf(p.department).includes(g.key)));
  if (rest.some(p => deptKeysOf(p.department).length === 1 && deptKeysOf(p.department)[0] === 'อื่นๆ')) columns.push({ key: 'อื่นๆ', label: 'อื่นๆ' });

  const rows = LEVELS.filter(lv => lv < TOP_LEVEL_THRESHOLD);

  // แยกคนธรรมดา (อยู่คอลัมน์เดียว) กับคนที่คุมมากกว่า 1 แผนก (span หลายคอลัมน์)
  const singlePeople = rest.filter(p => deptKeysOf(p.department).length <= 1);
  const spanPeople = rest.filter(p => deptKeysOf(p.department).length > 1);

  // จำนวนคนมากสุดในแต่ละแถว (ทุกคอลัมน์รวมกัน) เพื่อกำหนดความสูงแถว
  const cellPeople = {}; // `${level}|${colKey}` -> [people]
  rows.forEach(lv => columns.forEach(col => {
    cellPeople[`${lv}|${col.key}`] = singlePeople.filter(p => p.org_level === lv && groupOf(p.department) === col.key);
  }));
  const rowMaxCount = {};
  rows.forEach(lv => {
    rowMaxCount[lv] = Math.max(1, ...columns.map(col => cellPeople[`${lv}|${col.key}`].length || 1));
  });
  // คนที่ span หลายคอลัมน์ต้องการอย่างน้อย 1 แถวเพิ่ม ต่อจากคนที่อยู่คอลัมน์เดียว
  // ที่ทับซ้อนช่วงคอลัมน์เดียวกันอยู่แล้ว (ปกติจะไม่ทับซ้อน แต่กันไว้เผื่อ)
  const spanIdxByPerson = new Map();
  rows.forEach(lv => {
    spanPeople.filter(p => p.org_level === lv).forEach(p => {
      const keys = deptKeysOf(p.department).filter(k => columns.some(c => c.key === k));
      const idx = Math.max(0, ...keys.map(k => (cellPeople[`${lv}|${k}`] || []).length));
      spanIdxByPerson.set(p.user_id, idx);
      rowMaxCount[lv] = Math.max(rowMaxCount[lv], idx + 1);
    });
  });

  const colX = {};
  columns.forEach((col, i) => { colX[col.key] = LEFT_MARGIN + i * (CARD_W + COL_GAP) + CARD_W / 2; });
  const totalWidth = Math.max(
    LEFT_MARGIN + columns.length * (CARD_W + COL_GAP) - COL_GAP + 30,
    CARD_W + 60
  );
  const centerX = totalWidth / 2;

  const nodePos = new Map(); // user_id -> {x, y}
  let y = TOP_MARGIN;

  // ---- แถวผู้บริหาร/GM (ไม่มีแผนก วางกึ่งกลาง ซ้อนกันจากบนลงล่าง) -----------
  topLevelsPresent.forEach(lv => {
    const people = topPeople.filter(p => p.org_level === lv);
    const rowW = people.length * (CARD_W + COL_GAP) - COL_GAP;
    people.forEach((p, i) => {
      nodePos.set(p.user_id, { x: centerX - rowW / 2 + CARD_W / 2 + i * (CARD_W + COL_GAP), y: y + CARD_H / 2 });
    });
    y += CARD_H + ROW_GAP;
  });

  // ---- แถว Matrix (ระดับ < 85 แบ่งตามสายงาน) --------------------------------
  y += HEADER_H;
  const colLabelY = y - HEADER_H;
  const rowTop = {};
  rows.forEach(lv => {
    const rowH = rowMaxCount[lv] * (CARD_H + CARD_GAP_Y) - CARD_GAP_Y;
    rowTop[lv] = y;
    columns.forEach(col => {
      const people = cellPeople[`${lv}|${col.key}`];
      people.forEach((p, idx) => {
        nodePos.set(p.user_id, { x: colX[col.key], y: y + idx * (CARD_H + CARD_GAP_Y) + CARD_H / 2 });
      });
    });
    // คนที่ span หลายคอลัมน์: วาง Block ไว้ตรงกลางของทุกคอลัมน์ที่ตัวเองคุม
    spanPeople.filter(p => p.org_level === lv).forEach(p => {
      const keys = deptKeysOf(p.department).filter(k => columns.some(c => c.key === k));
      if (!keys.length) return;
      const xs = keys.map(k => colX[k]);
      const centerXSpan = (Math.min(...xs) + Math.max(...xs)) / 2;
      const idx = spanIdxByPerson.get(p.user_id) || 0;
      nodePos.set(p.user_id, { x: centerXSpan, y: y + idx * (CARD_H + CARD_GAP_Y) + CARD_H / 2 });
    });
    y += rowH + ROW_GAP;
  });
  const totalHeight = y - ROW_GAP + 20;

  // ---- เส้นเชื่อม (SVG) -----------------------------------------------------
  const links = [];
  allPeople.forEach(p => {
    if (!p.supervisor_id) return;
    const from = nodePos.get(p.supervisor_id);
    const to = nodePos.get(p.user_id);
    if (!from || !to) return;
    const midY = (from.y + CARD_H / 2 + to.y - CARD_H / 2) / 2;
    links.push(`<path d="M ${from.x} ${from.y + CARD_H / 2} V ${midY} H ${to.x} V ${to.y - CARD_H / 2}" class="org-link" fill="none" />`);
  });

  container.innerHTML = `
    <div class="card mb-16" style="padding:10px 14px">
      <p class="text-muted" style="margin:0;font-size:13px">
        คลิกที่การ์ดพนักงานเพื่อดูเป้าหมาย/ทีเด็ด/Scoreboard ${currentUser.role === 'ADMIN' ? '· สิทธิ์ผู้ดูแลระบบสามารถเพิ่ม/แก้ไขเป้าหมาย ทีเด็ด และลบพนักงานได้จากหน้านี้' : '· ผู้บังคับบัญชาสามารถลบลูกน้องในสายงานของตนได้'}
      </p>
    </div>
    <div class="org-tree-wrap">
      <div class="org-tree-canvas" style="width:${totalWidth}px;height:${totalHeight}px">
        ${columns.map(col => `<div class="org-tree-col-label" style="left:${colX[col.key]}px;top:${colLabelY}px;width:${CARD_W}px">${esc(col.label)}</div>`).join('')}
        <svg class="org-tree-svg" width="${totalWidth}" height="${totalHeight}">
          <style>.org-link { stroke: var(--border); stroke-width: 1.6px; }</style>
          ${links.join('')}
        </svg>
        ${rows.map(lv => `<div class="org-tree-level-label" style="top:${rowTop[lv] + (rowMaxCount[lv] * (CARD_H + CARD_GAP_Y) - CARD_GAP_Y) / 2}px">${LEVEL_LABEL[lv]}</div>`).join('')}
        ${topPeople.map(p => nodeHtml(p, nodePos.get(p.user_id), true)).join('')}
        ${singlePeople.map(p => {
          const pos = nodePos.get(p.user_id);
          return pos ? nodeHtml(p, pos, false) : '';
        }).join('')}
        ${spanPeople.map(p => {
          const pos = nodePos.get(p.user_id);
          return pos ? nodeHtml(p, pos, false, true) : '';
        }).join('')}
      </div>
    </div>
  `;

  container.querySelectorAll('[data-person]').forEach(el => {
    el.onclick = () => openPersonModal(Number(el.dataset.person));
  });

  allPeople.forEach(p => loadAchievementBadge(p.user_id));
}

function nodeHtml(p, pos, isTop, isSpan) {
  return `
    <div class="org-tree-node ${isTop ? 'gm-node' : ''} ${isSpan ? 'span-node' : ''}" data-person="${p.user_id}" style="left:${pos.x}px;top:${pos.y}px">
      <div class="name">${p.org_level >= 95 ? '⭐ ' : p.org_level >= 85 ? '👑 ' : ''}${esc(p.first_name)} ${esc(p.last_name)}</div>
      <div class="pos">${esc(p.position_title || '')}</div>
      <div class="achv-row" id="achv-${p.user_id}">
        <div class="achv-bar"><span style="width:0%;background:var(--border)"></span></div>
        <span class="achv-val">…</span>
      </div>
    </div>
  `;
}

async function loadAchievementBadge(userId) {
  const slot = document.getElementById(`achv-${userId}`);
  if (!slot) return;
  try {
    const analytics = await api.getIndividualAnalytics(userId, CURRENT_YEAR_CE);
    const val = analytics.overall_achievement;
    const pct = val == null ? 0 : Math.min(100, Math.max(0, val));
    const color = val == null ? 'var(--border)' : val >= 100 ? 'var(--green)' : val >= 80 ? 'var(--amber)' : 'var(--red)';
    slot.innerHTML = `
      <div class="achv-bar"><span style="width:${pct}%;background:${color}"></span></div>
      <span class="achv-val">${val != null ? val + '%' : '—'}</span>
    `;
  } catch {
    slot.innerHTML = `<span class="achv-val">🔒</span>`;
  }
}

// ============================================================================
// Modal: ดู + (ถ้า ADMIN) แก้ไข เป้าหมาย/ทีเด็ด/Scoreboard ของบุคคล
// ============================================================================
async function openPersonModal(userId) {
  const person = byId.get(userId);
  const backdrop = openModal(`<div class="loading-page"><span class="spinner"></span></div>`);
  backdrop.querySelector('.modal').style.width = '860px';
  await refreshPersonModal(backdrop, userId, person);
}

async function refreshPersonModal(backdrop, userId, person) {
  let goals, scoreboard;
  try {
    [goals, scoreboard] = await Promise.all([
      api.listGoals(userId, CURRENT_YEAR_CE),
      api.getScoreboard(userId, CURRENT_YEAR_CE),
    ]);
  } catch (err) {
    backdrop.querySelector('.modal').innerHTML = `<div class="empty-state"><div class="icon">🔒</div>${esc(err.message)}</div>
      <div class="flex" style="justify-content:flex-end"><button class="btn" id="close-btn">ปิด</button></div>`;
    backdrop.querySelector('#close-btn').onclick = () => closeModal(backdrop);
    return;
  }

  const canEdit = currentUser.role === 'ADMIN';
  const canDelete = userId !== currentUser.user_id &&
    (currentUser.role === 'ADMIN' || (currentUser.role === 'SUPERVISOR' && subordinateIds.has(userId)));

  const rowsHtml = goals.map(g => {
    const monthly = scoreboard.filter(s => s.goal_id === g.goal_id);
    const goalRow = `
      <tr class="goal-row">
        <td class="goal-title-cell">${esc(g.goal_title)} ${g.is_shared ? `<span class="pill yellow" style="margin-left:6px"><span class="dot"></span>ถือร่วมกับ ${esc(g.owner_name)}</span>` : ''}</td>
        <td>${g.target_value != null ? (OPERATOR_SYMBOL[g.evaluation_operator] || '≥') + ' ' + g.target_value : ''}${g.metric_unit ? ' ' + esc(g.metric_unit) : ''}</td>
        ${MONTHS_TH.map((_, i) => {
          const m = monthly.find(x => x.month_num === i + 1);
          const bg = m?.status_color === 'GREEN' ? 'var(--green-bg)' : m?.status_color === 'YELLOW' ? 'var(--amber-bg)' : m?.status_color === 'RED' ? 'var(--red-bg)' : '';
          return `<td style="background:${bg}">${m?.actual_val ?? ''}</td>`;
        }).join('')}
        ${canEdit ? `<td class="actions-cell">
          ${g.is_shared ? '<span class="text-dim" style="font-size:11px">อ่านอย่างเดียว</span>' : `
            <button class="btn btn-sm" data-edit-goal="${g.goal_id}">แก้ไข</button>
            <button class="btn btn-sm btn-danger" data-del-goal="${g.goal_id}">ลบ</button>
          `}
        </td>` : ''}
      </tr>`;
    const tacticsLine = g.tactics.map(t => `
      <span style="display:inline-flex;align-items:center;gap:4px;margin-right:10px">
        ⚡ ${esc(t.tactic_title)}
        ${canEdit && !g.is_shared ? `<a href="#" data-edit-tactic="${t.tactic_id}" data-goal="${g.goal_id}" style="font-size:11px">✏️</a><a href="#" data-del-tactic="${t.tactic_id}" style="font-size:11px">🗑️</a>` : ''}
      </span>`).join('');
    const tacticsRow = `
      <tr class="tactic-row">
        <td class="goal-title-cell" colspan="${2 + MONTHS_TH.length + (canEdit ? 1 : 0)}">
          ${tacticsLine || '<span class="text-dim">ยังไม่มีทีเด็ด</span>'}
          ${canEdit && !g.is_shared ? `<button class="btn btn-sm btn-ghost" data-add-tactic="${g.goal_id}">+ เพิ่มทีเด็ด</button>` : ''}
        </td>
      </tr>`;
    return goalRow + tacticsRow;
  }).join('');

  backdrop.querySelector('.modal').innerHTML = `
    <div class="flex-between" style="align-items:flex-start">
      <div>
        <h3 style="margin:0 0 2px">${esc(person.first_name)} ${esc(person.last_name)} ${person.nickname ? `(${esc(person.nickname)})` : ''}</h3>
        <p class="text-muted" style="margin:0;font-size:13px">${esc(person.position_title)} ${person.department ? '· ' + esc(person.department) : ''}</p>
      </div>
      <div class="flex gap-8">
        ${canDelete ? `<button class="btn btn-sm btn-danger" id="delete-person-btn">🗑️ ลบพนักงาน</button>` : ''}
        ${canEdit ? `<button class="btn btn-primary btn-sm" id="add-goal-btn">+ เพิ่มเป้าหมาย</button>` : ''}
      </div>
    </div>
    <div style="overflow-x:auto;margin-top:14px">
      ${goals.length ? `
      <table class="sb-modal-table">
        <thead>
          <tr>
            <th class="goal-title-head">เป้าหมาย / ทีเด็ด</th>
            <th>Target</th>
            ${MONTHS_TH.map(m => `<th>${m}</th>`).join('')}
            ${canEdit ? '<th></th>' : ''}
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>` : `<div class="empty-state"><div class="icon">🎯</div>ยังไม่มีเป้าหมายในปีนี้</div>`}
    </div>
    <div class="flex gap-8 mt-16" style="justify-content:flex-end">
      <button class="btn" id="close-btn">ปิด</button>
    </div>
  `;

  backdrop.querySelector('#close-btn').onclick = () => closeModal(backdrop);
  if (canDelete) {
    backdrop.querySelector('#delete-person-btn').onclick = () => deletePerson(userId, person, backdrop);
  }
  if (canEdit) {
    backdrop.querySelector('#add-goal-btn').onclick = () => openGoalEditModal(null, userId, backdrop);
    backdrop.querySelectorAll('[data-edit-goal]').forEach(b => b.onclick = () => openGoalEditModal(goals.find(g => g.goal_id == b.dataset.editGoal), userId, backdrop));
    backdrop.querySelectorAll('[data-del-goal]').forEach(b => b.onclick = async () => {
      if (!(await confirmDialog('ลบเป้าหมายนี้ใช่หรือไม่? ทีเด็ดภายใต้เป้าหมายนี้จะถูกลบไปด้วย'))) return;
      try { await api.deleteGoal(b.dataset.delGoal); toast('ลบเป้าหมายแล้ว'); await refreshPersonModal(backdrop, userId, person); }
      catch (err) { toast(err.message, 'error'); }
    });
    backdrop.querySelectorAll('[data-add-tactic]').forEach(b => b.onclick = (e) => { e.preventDefault(); openTacticEditModal(null, b.dataset.addTactic, userId, backdrop, person); });
    backdrop.querySelectorAll('[data-edit-tactic]').forEach(a => a.onclick = (e) => {
      e.preventDefault();
      const g = goals.find(g => g.goal_id == a.dataset.goal);
      const t = g.tactics.find(t => t.tactic_id == a.dataset.editTactic);
      openTacticEditModal(t, a.dataset.goal, userId, backdrop, person);
    });
    backdrop.querySelectorAll('[data-del-tactic]').forEach(a => a.onclick = async (e) => {
      e.preventDefault();
      if (!(await confirmDialog('ลบทีเด็ดนี้ใช่หรือไม่?'))) return;
      try { await api.deleteTactic(a.dataset.delTactic); toast('ลบทีเด็ดแล้ว'); await refreshPersonModal(backdrop, userId, person); }
      catch (err) { toast(err.message, 'error'); }
    });
  }
}

async function deletePerson(userId, person, backdrop) {
  const ok = await confirmDialog(
    `ลบ "${person.first_name} ${person.last_name}" ออกจากระบบใช่หรือไม่? ` +
    `ลูกน้องโดยตรงของคนนี้จะถูกเลื่อนขึ้นไปอยู่ใต้ผู้บังคับบัญชาของเขาแทนโดยอัตโนมัติ ` +
    `(ประวัติเป้าหมาย/Scoreboard ที่เคยบันทึกไว้จะยังอยู่ครบ)`
  );
  if (!ok) return;
  try {
    await api.deactivateUser(userId);
    closeModal(backdrop);
    toast('ลบพนักงานเรียบร้อย');
    if (lastContainer) await render(lastContainer, { user: currentUser });
  } catch (err) { toast(err.message, 'error'); }
}

function openGoalEditModal(goal, targetUserId, parentBackdrop) {
  const backdrop = openModal(`
    <h3 style="margin-top:0">${goal ? 'แก้ไขเป้าหมาย' : 'เพิ่มเป้าหมายใหม่'}</h3>
    <div class="field"><label>ชื่อเป้าหมาย</label><input id="f-title" value="${esc(goal?.goal_title || '')}"></div>
    <div class="field-row">
      <div class="field"><label>ตัวชี้วัด (หน่วย)</label><input id="f-unit" value="${esc(goal?.metric_unit || '')}"></div>
      <div class="field"><label>ค่าเป้าหมาย</label><input id="f-target" type="number" step="0.01" value="${goal?.target_value ?? ''}"></div>
    </div>
    <div class="field">
      <label>เงื่อนไขบรรลุเป้า</label>
      <select id="f-operator">
        ${Object.entries(OPERATOR_LABEL_TH).map(([k, v]) => `<option value="${k}" ${(goal?.evaluation_operator || 'GTE') === k ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
    </div>
    <div class="field"><label>น้ำหนัก (%)</label><input id="f-weight" type="number" step="0.01" value="${goal?.weight_percentage ?? ''}"></div>
    <div class="flex gap-8" style="justify-content:flex-end">
      <button class="btn" id="cancel-btn">ยกเลิก</button>
      <button class="btn btn-primary" id="save-btn">บันทึก</button>
    </div>
  `);
  backdrop.querySelector('#cancel-btn').onclick = () => closeModal(backdrop);
  backdrop.querySelector('#save-btn').onclick = async () => {
    try {
      await api.upsertGoal({
        goal_id: goal?.goal_id ?? null, target_user_id: targetUserId,
        goal_title: backdrop.querySelector('#f-title').value.trim(),
        metric_unit: backdrop.querySelector('#f-unit').value.trim(),
        target_value: numOrNull(backdrop.querySelector('#f-target').value),
        weight_percentage: numOrNull(backdrop.querySelector('#f-weight').value),
        evaluation_operator: backdrop.querySelector('#f-operator').value,
        year: CURRENT_YEAR_CE, parent_goal_id: goal?.parent_goal_id ?? null,
      });
      closeModal(backdrop);
      toast('บันทึกเป้าหมายเรียบร้อย');
      await refreshPersonModal(parentBackdrop, targetUserId, byId.get(targetUserId));
    } catch (err) { toast(err.message, 'error'); }
  };
}

function openTacticEditModal(tactic, goalId, targetUserId, parentBackdrop, person) {
  const backdrop = openModal(`
    <h3 style="margin-top:0">${tactic ? 'แก้ไขทีเด็ด' : 'เพิ่มทีเด็ดใหม่'}</h3>
    <div class="field"><label>ชื่อทีเด็ด</label><input id="f-title" value="${esc(tactic?.tactic_title || '')}"></div>
    <div class="field"><label>รายละเอียดแผนปฏิบัติการ</label><textarea id="f-desc" rows="3">${esc(tactic?.action_plan_description || '')}</textarea></div>
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
      });
      closeModal(backdrop);
      toast('บันทึกทีเด็ดเรียบร้อย');
      await refreshPersonModal(parentBackdrop, targetUserId, person);
    } catch (err) { toast(err.message, 'error'); }
  };
}

function numOrNull(v) { return v === '' || v === null || v === undefined ? null : Number(v); }
