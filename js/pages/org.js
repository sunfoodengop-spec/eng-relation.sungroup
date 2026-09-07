import { api } from '../api.js';
import { toast, openModal, closeModal, confirmDialog, MONTHS_TH, escapeHtml as esc, OPERATOR_SYMBOL, OPERATOR_LABEL_TH } from '../ui.js';
import { CURRENT_YEAR_CE } from '../config.js';
import { openPasteImportModal } from '../pasteImport.js';

const LEVELS = [80, 75, 65, 55, 40]; // บนสุด -> ล่างสุด
const LEVEL_LABEL = { 95: 'ผู้บริหาร', 85: 'GM', 75: 'ผจก.ฝ่าย', 65: 'ผจก.ส่วน', 55: 'ผจก.แผนก', 40: 'จนท.' };
const TOP_LEVEL_THRESHOLD = 80; // ระดับตั้งแต่นี้ขึ้นไปไม่มีแผนก จะวาดเป็นแถวคานกลางเหนือ Matrix

// รายชื่อแผนก (คอลัมน์ผังองค์กร) ไม่ hardcode อีกต่อไป — โหลดจาก
// api.listDepartments() ทุกครั้งที่ render (ดูตาราง `departments` ใน
// sql/patch_001_departments.sql) Admin เพิ่ม/แก้ชื่อแผนกได้จากหน้า "จัดการผู้ใช้"
let departments = []; // { key, label } เรียงตาม sort_order แล้วจาก RPC

// คนที่คุมมากกว่า 1 แผนก: department ใน DB เก็บเป็น raw tag คั่นด้วย comma
// เช่น 'OPRF,SRN,ENF' — deptKeysOf คืนค่าเป็น array ของ dept key ทั้งหมดที่ match
// (ความยาว > 1 = ต้องวาง Block ตรงกลางคร่อมทุกคอลัมน์ที่คุม)
function deptKeysOf(dept) {
  if (!dept) return [];
  return dept.split(',').map(s => s.trim()).filter(Boolean)
    .map(tag => (departments.some(d => d.key === tag) ? tag : 'อื่นๆ'));
}
// สายผู้ชำนาญการ/ผู้เชี่ยวชาญ: ตรวจจากคำในตำแหน่ง — เยื้องขวาออกจากสายบังคับบัญชา
// หลัก + กรอบเส้นประ (ดู requirement ล่าสุด)
function isSpecialist(p) {
  const t = p.position_title || '';
  return t.includes('ผู้เชี่ยวชาญ') || t.includes('ผู้ชำนาญการ');
}
function sortByEmpCode(list) {
  return [...list].sort((a, b) => (a.emp_code || '').localeCompare(b.emp_code || '', undefined, { numeric: true }));
}

// ---- Layout constants (px) -------------------------------------------------
const CARD_W = 172, CARD_H = 62, CARD_GAP_X = 10, COL_GAP = 40, ROW_GAP = 60, SPECIALIST_GAP = 20;
const HEADER_H = 30, TOP_MARGIN = 16, LEFT_MARGIN = 70;
// สีพื้นหลังแยกแต่ละคอลัมน์แผนก (วนซ้ำถ้าแผนกเยอะกว่าจำนวนสี)
const COL_BG_PALETTE = [
  'rgba(99,102,241,.10)', 'rgba(16,185,129,.10)', 'rgba(245,158,11,.10)',
  'rgba(236,72,153,.10)', 'rgba(14,165,233,.10)', 'rgba(168,85,247,.10)',
  'rgba(239,68,68,.10)', 'rgba(20,184,166,.10)', 'rgba(234,179,8,.10)',
];

let allPeople = [];
let byId = new Map();
let currentUser = null;
let subordinateIds = new Set(); // สำหรับ SUPERVISOR เช็คสิทธิ์ลบ (Admin ไม่ต้องเช็ค)
let lastContainer = null;

export async function render(container, ctx) {
  currentUser = ctx.user;
  lastContainer = container;
  container.innerHTML = `<div class="loading-page"><span class="spinner"></span></div>`;

  const [orgChart, depts] = await Promise.all([api.getOrgChart(), api.listDepartments()]);
  allPeople = orgChart;
  departments = depts.map(d => ({ key: d.dept_key, label: d.label }));

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
  const rows = LEVELS.filter(lv => lv < TOP_LEVEL_THRESHOLD);

  // แยกคน 3 กลุ่ม:
  //  - spanPeople: คุมมากกว่า 1 แผนก -> วาง Block ตรงกลางคร่อมทุกคอลัมน์ที่คุม
  //  - specialistPeople: ตำแหน่งผู้เชี่ยวชาญ/ผู้ชำนาญการ (แผนกเดียว) -> เยื้องขวา เส้นประ
  //  - mainPeople: สายบังคับบัญชาปกติ (แผนกเดียว) -> เรียงแนวนอนในแถวเดียวกันตาม emp_code
  const spanPeople = rest.filter(p => deptKeysOf(p.department).length > 1);
  const specialistPeople = rest.filter(p => deptKeysOf(p.department).length === 1 && isSpecialist(p));
  const mainPeople = rest.filter(p => deptKeysOf(p.department).length === 1 && !isSpecialist(p));

  const columns = departments.filter(col => rest.some(p => deptKeysOf(p.department).includes(col.key)));
  if (rest.some(p => deptKeysOf(p.department).includes('อื่นๆ'))) columns.push({ key: 'อื่นๆ', label: 'อื่นๆ' });

  // จัดคนในแต่ละ (ระดับ, คอลัมน์) ให้เรียงแนวนอนตาม emp_code จากน้อย(ซ้าย)ไปมาก(ขวา)
  // แยกเลนหลัก (mainCell) กับเลนผู้เชี่ยวชาญที่เยื้องออกไปทางขวา (specCell)
  const mainCell = {}, specCell = {};
  rows.forEach(lv => columns.forEach(col => {
    mainCell[`${lv}|${col.key}`] = sortByEmpCode(mainPeople.filter(p => p.org_level === lv && deptKeysOf(p.department)[0] === col.key));
    specCell[`${lv}|${col.key}`] = sortByEmpCode(specialistPeople.filter(p => p.org_level === lv && deptKeysOf(p.department)[0] === col.key));
  }));

  // ความกว้างของแต่ละคอลัมน์ขึ้นกับจำนวนคนมากสุดที่ต้องเรียงแนวนอนในระดับใดระดับหนึ่ง
  const mainFanout = {}, specFanout = {};
  columns.forEach(col => {
    mainFanout[col.key] = Math.max(1, ...rows.map(lv => mainCell[`${lv}|${col.key}`].length || 1));
    specFanout[col.key] = Math.max(0, ...rows.map(lv => specCell[`${lv}|${col.key}`].length));
  });
  const mainW = {}, specW = {}, colTotalW = {};
  columns.forEach(col => {
    mainW[col.key] = mainFanout[col.key] * CARD_W + (mainFanout[col.key] - 1) * CARD_GAP_X;
    specW[col.key] = specFanout[col.key] > 0 ? specFanout[col.key] * CARD_W + (specFanout[col.key] - 1) * CARD_GAP_X : 0;
    colTotalW[col.key] = mainW[col.key] + (specFanout[col.key] > 0 ? SPECIALIST_GAP + specW[col.key] : 0);
  });

  const colLeftX = {}, mainLeftX = {}, specLeftX = {}, colCenterX = {};
  let cursorX = LEFT_MARGIN;
  columns.forEach(col => {
    colLeftX[col.key] = cursorX;
    mainLeftX[col.key] = cursorX;
    specLeftX[col.key] = cursorX + mainW[col.key] + SPECIALIST_GAP;
    colCenterX[col.key] = cursorX + colTotalW[col.key] / 2;
    cursorX += colTotalW[col.key] + COL_GAP;
  });
  const totalWidth = Math.max(cursorX - COL_GAP + 30, CARD_W + 60);
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

  // ---- แถว Matrix (ระดับ < 80 แบ่งตามสายงาน, ระดับเดียวกันอยู่แถวเดียวกันเสมอ) ----
  y += HEADER_H;
  const colLabelY = y - HEADER_H;
  const rowTop = {};
  rows.forEach(lv => {
    rowTop[lv] = y;
    const rowCenterY = y + CARD_H / 2;
    columns.forEach(col => {
      // จัดกึ่งกลางแนวนอนของคนแต่ละแถวภายในความกว้างเลนของคอลัมน์นั้น (ไม่ใช่ชิดซ้าย)
      // เพื่อให้สายที่โยงมาจากหัวหน้าด้านบน (เช่น หัวหน้าคนเดียวใน 1 แถว แต่ลูกทีม
      // 2 คนในแถวถัดไป) วางตัวสมมาตรอยู่กึ่งกลางของลูกทีมเสมอ แทนที่จะชิดซ้าย
      const mainRow = mainCell[`${lv}|${col.key}`];
      const mainRowW = mainRow.length * (CARD_W + CARD_GAP_X) - CARD_GAP_X;
      const mainStartX = mainLeftX[col.key] + (mainW[col.key] - mainRowW) / 2;
      mainRow.forEach((p, i) => {
        nodePos.set(p.user_id, { x: mainStartX + i * (CARD_W + CARD_GAP_X) + CARD_W / 2, y: rowCenterY });
      });
      const specRow = specCell[`${lv}|${col.key}`];
      const specRowW = specRow.length * (CARD_W + CARD_GAP_X) - CARD_GAP_X;
      const specStartX = specLeftX[col.key] + (specW[col.key] - specRowW) / 2;
      specRow.forEach((p, i) => {
        nodePos.set(p.user_id, { x: specStartX + i * (CARD_W + CARD_GAP_X) + CARD_W / 2, y: rowCenterY });
      });
    });
    // คนที่ span หลายคอลัมน์: วาง Block ไว้ตรงกลางของทุกคอลัมน์ที่ตัวเองคุม
    spanPeople.filter(p => p.org_level === lv).forEach(p => {
      const keys = deptKeysOf(p.department).filter(k => columns.some(c => c.key === k));
      if (!keys.length) return;
      const leftMost = Math.min(...keys.map(k => colLeftX[k]));
      const rightMost = Math.max(...keys.map(k => colLeftX[k] + colTotalW[k]));
      nodePos.set(p.user_id, { x: (leftMost + rightMost) / 2, y: rowCenterY });
    });
    y += CARD_H + ROW_GAP;
  });
  const totalHeight = y - ROW_GAP + 20;

  // ---- เส้นเชื่อม (SVG) -----------------------------------------------------
  // เดิมเส้นแต่ละคู่หัวหน้า-ลูกน้องหักมุมที่ "จุดกึ่งกลาง" ระหว่างสอง node ซึ่งสูง
  // ไม่เท่ากันในแต่ละคู่ (ขึ้นกับระดับของลูกน้องแต่ละคน) ทำให้เส้นจากหัวหน้าคนละคน
  // ไปตัดกันที่ความสูงมั่วๆ ดูเหมือนเป็นสายเดียวกัน — ตอนนี้เปลี่ยนเป็น "เส้นบัส"
  // ที่ตำแหน่งคงที่ต่อ 1 ระดับหัวหน้า (ทุกคนในระดับเดียวกันหักมุมที่ความสูงเดียวกัน
  // เป๊ะ) โดยเฉพาะเส้นจาก GM/ผู้บริหารบนสุด บังคับให้หักมุมเหนือแถวระดับ 75 เสมอ
  // แม้แผนกนั้นจะไม่มีคนระดับ 75 อยู่จริงก็ตาม (ข้ามลงไปแถวล่างต่อด้วยเส้นตรงดิ่ง)
  const LINK_BUS_GAP = 14;
  function busYForSupervisorLevel(level) {
    const idx = LEVELS.indexOf(level);
    const nextLevel = idx >= 0 ? LEVELS[idx + 1] : undefined;
    if (nextLevel !== undefined && rowTop[nextLevel] !== undefined) return rowTop[nextLevel] - LINK_BUS_GAP;
    return null; // ระดับล่างสุดไม่มีแถวถัดไปให้อ้างอิง ใช้ fallback ต่อคู่แทน
  }
  const links = [];
  allPeople.forEach(p => {
    if (!p.supervisor_id) return;
    const supervisor = byId.get(p.supervisor_id);
    const from = nodePos.get(p.supervisor_id);
    const to = nodePos.get(p.user_id);
    if (!from || !to || !supervisor) return;
    const busY = busYForSupervisorLevel(supervisor.org_level) ?? (from.y + CARD_H / 2 + ROW_GAP / 2);
    links.push(`<path d="M ${from.x} ${from.y + CARD_H / 2} V ${busY} H ${to.x} V ${to.y - CARD_H / 2}" class="org-link" fill="none" />`);
  });

  // ---- พื้นหลังแยกสีต่อคอลัมน์แผนก (ให้เห็นการแยกแผนกชัดเจน) -----------------
  const bgTop = colLabelY - 4;
  const bgHeight = totalHeight - bgTop - 6;
  const colBgHtml = columns.map((col, i) => `
    <div class="org-tree-col-bg" style="left:${colLeftX[col.key]}px;top:${bgTop}px;width:${colTotalW[col.key]}px;height:${bgHeight}px;background:${COL_BG_PALETTE[i % COL_BG_PALETTE.length]}"></div>
  `).join('');

  container.innerHTML = `
    <div class="card mb-16 flex-between" style="padding:10px 14px">
      <p class="text-muted" style="margin:0;font-size:13px">
        คลิกที่การ์ดพนักงานเพื่อดูเป้าหมาย/ทีเด็ด/Scoreboard ${currentUser.role === 'ADMIN' ? '· สิทธิ์ผู้ดูแลระบบสามารถเพิ่ม/แก้ไขเป้าหมาย ทีเด็ด และลบพนักงานได้จากหน้านี้' : '· ผู้บังคับบัญชาสามารถลบลูกน้องในสายงานของตนได้'}
        · เส้นประ = สายผู้เชี่ยวชาญ/ผู้ชำนาญการ
      </p>
      <button class="btn btn-sm" id="export-pdf-btn" style="white-space:nowrap">📄 Export PDF</button>
    </div>
    <div class="org-tree-wrap" id="org-print-root">
      <div class="org-tree-canvas" style="width:${totalWidth}px;height:${totalHeight}px">
        ${colBgHtml}
        ${columns.map(col => `<div class="org-tree-col-label" style="left:${colCenterX[col.key]}px;top:${colLabelY}px;width:${colTotalW[col.key]}px">${esc(col.label)}</div>`).join('')}
        <svg class="org-tree-svg" width="${totalWidth}" height="${totalHeight}">
          <style>.org-link { stroke: var(--border); stroke-width: 1.6px; stroke-linejoin: round; stroke-linecap: round; }</style>
          ${links.join('')}
        </svg>
        ${rows.map(lv => `<div class="org-tree-level-label" style="top:${rowTop[lv] + CARD_H / 2}px">${LEVEL_LABEL[lv]}</div>`).join('')}
        ${topPeople.map(p => nodeHtml(p, nodePos.get(p.user_id), true)).join('')}
        ${mainPeople.map(p => {
          const pos = nodePos.get(p.user_id);
          return pos ? nodeHtml(p, pos, false) : '';
        }).join('')}
        ${spanPeople.map(p => {
          const pos = nodePos.get(p.user_id);
          return pos ? nodeHtml(p, pos, false, true) : '';
        }).join('')}
        ${specialistPeople.map(p => {
          const pos = nodePos.get(p.user_id);
          return pos ? nodeHtml(p, pos, false, false, true) : '';
        }).join('')}
      </div>
    </div>
  `;

  container.querySelectorAll('[data-person]').forEach(el => {
    el.onclick = () => openPersonModal(Number(el.dataset.person));
  });
  document.getElementById('export-pdf-btn').onclick = () => exportOrgChartPDF(totalWidth, totalHeight);

  allPeople.forEach(p => loadAchievementBadge(p.user_id));
}

// ============================================================================
// Export PDF — ใช้ browser "พิมพ์" (window.print) แทนการแปลงเป็นรูปภาพ (canvas/PNG)
// เพราะข้อความและเส้น SVG จะยังเป็น vector อยู่เสมอ ซูมเข้าไปเท่าไหร่ก็ไม่แตก
// ต่างจากการแปลงเป็น PNG ก่อนที่จะเบลอ/แตกเป็นพิกเซลเมื่อซูม — ปรับ scale ให้พอดี
// กระดาษ 1 หน้าแนวนอนก่อนสั่งพิมพ์ แล้วคืนค่าทันทีหลังพิมพ์เสร็จ (เห็นผลปกติต่อ)
// ============================================================================
function exportOrgChartPDF(totalWidth, totalHeight) {
  const root = document.getElementById('org-print-root');
  const canvas = root?.querySelector('.org-tree-canvas');
  if (!root || !canvas) return;

  // ขนาดพื้นที่พิมพ์โดยประมาณของกระดาษแนวนอน 1 หน้า (px ที่ ~96dpi หักขอบแล้ว)
  const PAGE_W = 1120, PAGE_H = 760;
  const scale = Math.min(PAGE_W / totalWidth, PAGE_H / totalHeight, 1);
  canvas.style.transform = `scale(${scale})`;
  canvas.style.transformOrigin = 'top left';
  root.style.width = `${totalWidth * scale}px`;
  root.style.height = `${totalHeight * scale}px`;

  document.body.classList.add('printing-org-chart');
  const cleanup = () => {
    document.body.classList.remove('printing-org-chart');
    canvas.style.transform = '';
    canvas.style.transformOrigin = '';
    root.style.width = '';
    root.style.height = '';
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  setTimeout(() => { window.print(); }, 60); // รอ reflow ก่อนเปิดไดอะล็อกพิมพ์
}

function nodeHtml(p, pos, isTop, isSpan, isSpecialistNode) {
  return `
    <div class="org-tree-node ${isTop ? 'gm-node' : ''} ${isSpan ? 'span-node' : ''} ${isSpecialistNode ? 'specialist-node' : ''}" data-person="${p.user_id}" style="left:${pos.x}px;top:${pos.y}px">
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
// Modal: ดู + (ถ้ามีสิทธิ์) แก้ไข เป้าหมาย/ทีเด็ด/Scoreboard ของบุคคล
//
// สิทธิ์แก้ไข (canEdit) ตอนนี้ไม่ได้จำกัดแค่ ADMIN หรือ "ลูกน้องสายตรง" อีกต่อไป —
// หัวหน้างาน (SUPERVISOR) แก้ไขได้เพิ่มสำหรับ "ใครก็ตามที่แผนกเดียวกัน และมีระดับ
// (org_level) ต่ำกว่าตัวเอง" ด้วย แม้จะไม่ได้อยู่ในสายบังคับบัญชาตรงก็ตาม — ต้อง
// ตรงกับ _same_dept_higher_level() ฝั่ง backend เป๊ะ (ดู sql/patch_003_*.sql)
// มิฉะนั้นปุ่มจะกดได้แต่ backend จะ FORBIDDEN
// ============================================================================
function deptsOverlap(deptA, deptB) {
  const a = (deptA || '').split(',').map(s => s.trim()).filter(Boolean);
  const b = (deptB || '').split(',').map(s => s.trim()).filter(Boolean);
  return a.some(x => b.includes(x));
}
function canManagePerson(person) {
  if (!person) return false;
  if (currentUser.role === 'ADMIN') return true;
  if (currentUser.user_id === person.user_id) return true;
  if (currentUser.role !== 'SUPERVISOR') return false;
  if (subordinateIds.has(person.user_id)) return true; // สายบังคับบัญชาตรง (เดิม)
  // สิทธิ์ใหม่: แผนกเดียวกัน + ระดับสูงกว่า
  return currentUser.org_level > person.org_level && deptsOverlap(currentUser.department, person.department);
}

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

  const canEdit = canManagePerson(person);
  const canDelete = userId !== currentUser.user_id &&
    (currentUser.role === 'ADMIN' || (currentUser.role === 'SUPERVISOR' && subordinateIds.has(userId)));

  const rowsHtml = goals.map(g => {
    const primaryMetricId = g.metrics[0]?.metric_id;
    const primaryMonthly = scoreboard.filter(s => s.goal_id === g.goal_id && s.metric_id === primaryMetricId);
    const overallByMonth = new Map();
    scoreboard.filter(s => s.goal_id === g.goal_id).forEach(s => overallByMonth.set(s.month_num, s));
    const goalRow = `
      <tr class="goal-row">
        <td class="goal-title-cell">${esc(g.goal_title)} ${g.is_shared ? `<span class="pill yellow" style="margin-left:6px"><span class="dot"></span>ถือร่วมกับ ${esc(g.owner_name)}</span>` : ''}</td>
        <td class="text-muted" style="font-size:12px">${g.metrics.length} ตัววัด</td>
        ${MONTHS_TH.map((_, i) => {
          const ov = overallByMonth.get(i + 1);
          const bg = ov?.overall_status_color === 'GREEN' ? 'var(--green-bg)' : ov?.overall_status_color === 'YELLOW' ? 'var(--amber-bg)' : ov?.overall_status_color === 'RED' ? 'var(--red-bg)' : '';
          const primary = primaryMonthly.find(x => x.month_num === i + 1);
          return `<td style="background:${bg}">${primary?.actual_val ?? ''}</td>`;
        }).join('')}
        ${canEdit ? `<td class="actions-cell">
          ${g.is_shared ? '<span class="text-dim" style="font-size:11px">อ่านอย่างเดียว</span>' : `
            <button class="btn btn-sm" data-edit-goal="${g.goal_id}">แก้ไข</button>
            <button class="btn btn-sm btn-danger" data-del-goal="${g.goal_id}">ลบ</button>
          `}
        </td>` : ''}
      </tr>`;
    const metricsLine = g.metrics.map(m => `
      <span style="display:inline-flex;align-items:center;gap:4px;margin-right:10px;font-size:12px">
        📏 ${esc(m.metric_unit || '-')} ${OPERATOR_SYMBOL[m.evaluation_operator] || '≥'} ${m.target_value ?? '-'}
        ${canEdit && !g.is_shared ? `<a href="#" data-edit-metric="${m.metric_id}" data-goal="${g.goal_id}" style="font-size:11px">✏️</a>${g.metrics.length > 1 ? `<a href="#" data-del-metric="${m.metric_id}" style="font-size:11px">🗑️</a>` : ''}` : ''}
      </span>`).join('');
    const metricsRow = `
      <tr class="tactic-row">
        <td class="goal-title-cell" colspan="${2 + MONTHS_TH.length + (canEdit ? 1 : 0)}">
          ${metricsLine || '<span class="text-dim">ยังไม่มีตัววัด</span>'}
          ${canEdit && !g.is_shared ? `<button class="btn btn-sm btn-ghost" data-add-metric="${g.goal_id}">+ เพิ่มตัววัด</button>` : ''}
        </td>
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
    return goalRow + metricsRow + tacticsRow;
  }).join('');

  backdrop.querySelector('.modal').innerHTML = `
    <div class="flex-between" style="align-items:flex-start">
      <div>
        <h3 style="margin:0 0 2px">${esc(person.first_name)} ${esc(person.last_name)} ${person.nickname ? `(${esc(person.nickname)})` : ''}</h3>
        <p class="text-muted" style="margin:0;font-size:13px">${esc(person.position_title)} ${person.department ? '· ' + esc(person.department) : ''}</p>
      </div>
      <div class="flex gap-8">
        ${canDelete ? `<button class="btn btn-sm btn-danger" id="delete-person-btn">🗑️ ลบพนักงาน</button>` : ''}
        ${canEdit ? `<button class="btn btn-sm" id="import-goals-btn">📋 นำเข้าจาก Excel</button>` : ''}
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
    backdrop.querySelector('#import-goals-btn').onclick = () => openPersonGoalsImportModal(userId, goals, person, backdrop);
    backdrop.querySelectorAll('[data-edit-goal]').forEach(b => b.onclick = () => openGoalEditModal(goals.find(g => g.goal_id == b.dataset.editGoal), userId, backdrop));
    backdrop.querySelectorAll('[data-del-goal]').forEach(b => b.onclick = async () => {
      if (!(await confirmDialog('ลบเป้าหมายนี้ใช่หรือไม่? ทีเด็ดภายใต้เป้าหมายนี้จะถูกลบไปด้วย'))) return;
      try { await api.deleteGoal(b.dataset.delGoal); toast('ลบเป้าหมายแล้ว'); await refreshPersonModal(backdrop, userId, person); }
      catch (err) { toast(err.message, 'error'); }
    });
    backdrop.querySelectorAll('[data-add-metric]').forEach(b => b.onclick = () => openMetricEditModal(b.dataset.addMetric, null, userId, backdrop, person));
    backdrop.querySelectorAll('[data-edit-metric]').forEach(a => a.onclick = (e) => {
      e.preventDefault();
      const g = goals.find(g => g.goal_id == a.dataset.goal);
      const m = g.metrics.find(m => m.metric_id == a.dataset.editMetric);
      openMetricEditModal(a.dataset.goal, m, userId, backdrop, person);
    });
    backdrop.querySelectorAll('[data-del-metric]').forEach(a => a.onclick = async (e) => {
      e.preventDefault();
      if (!(await confirmDialog('ลบตัววัดนี้ใช่หรือไม่?'))) return;
      try { await api.deleteGoalMetric(a.dataset.delMetric); toast('ลบตัววัดแล้ว'); await refreshPersonModal(backdrop, userId, person); }
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

function openPersonGoalsImportModal(userId, goals, person, backdrop) {
  const headers = ['ชื่อเป้าหมาย', 'หน่วยวัด (ตัววัดหลัก)', 'ค่าเป้าหมาย', 'น้ำหนัก(%)', 'เงื่อนไข(>,>=,<,<=,=)'];
  const blankRows = goals.map(g => {
    const m0 = g.metrics[0] || {};
    return [g.goal_title, m0.metric_unit || '', m0.target_value ?? '', g.weight_percentage ?? '', OPERATOR_SYMBOL[m0.evaluation_operator] || '≥'];
  });
  openPasteImportModal({
    title: `📋 นำเข้าเป้าหมายให้ ${esc(person.first_name)} ${esc(person.last_name)}`,
    instructions: `นำเข้าเป้าหมายปี ${CURRENT_YEAR_CE + 543} — ถ้าชื่อเป้าหมายตรงกับที่มีอยู่แล้วจะอัปเดตทับ ถ้าไม่มีจะสร้างใหม่ให้อัตโนมัติ นำเข้าได้เฉพาะ "ตัววัดหลักตัวแรก" เท่านั้น ตัววัดเพิ่มเติมให้เพิ่มเองในฟอร์ม`,
    headers, blankRows, filename: `goals_${person.emp_code || userId}.csv`,
    onImport: async (rows) => {
      let ok = 0, fail = 0;
      for (const r of rows) {
        const [title, unit, target, weight, opRaw] = r;
        if (!title || !title.trim()) continue;
        const existing = goals.find(g => g.goal_title.trim() === title.trim());
        try {
          const goalId = await api.upsertGoal({
            goal_id: existing?.goal_id ?? null, target_user_id: userId,
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
      await refreshPersonModal(backdrop, userId, byId.get(userId));
      return { ok, fail, total: rows.length };
    },
  });
}

// รับได้ทั้งสัญลักษณ์ (>, >=, ≥, <, <=, ≤, =) และคำไทยเต็ม (จาก OPERATOR_LABEL_TH)
function parseOperatorInput(raw) {
  const s = (raw || '').trim();
  const symMap = { '>': 'GT', '>=': 'GTE', '≥': 'GTE', '<': 'LT', '<=': 'LTE', '≤': 'LTE', '=': 'EQ' };
  if (symMap[s]) return symMap[s];
  const found = Object.entries(OPERATOR_LABEL_TH).find(([, label]) => label === s);
  return found ? found[0] : 'GTE';
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
    <div class="field"><label>น้ำหนัก (%)</label><input id="f-weight" type="number" step="0.01" value="${goal?.weight_percentage ?? ''}"></div>
    ${!goal ? `<div class="hint-box">เพิ่มตัววัดแรกได้หลังบันทึกเป้าหมายนี้แล้ว</div>` : ''}
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
        goal_id: goal?.goal_id ?? null, target_user_id: targetUserId, goal_title: title,
        weight_percentage: numOrNull(backdrop.querySelector('#f-weight').value),
        year: CURRENT_YEAR_CE, parent_goal_id: goal?.parent_goal_id ?? null,
      });
      if (!goal) {
        const metricId = await api.upsertGoalMetric({ goal_id: newGoalId, metric_unit: '', target_value: null, evaluation_operator: 'GTE', sort_order: 0 });
        closeModal(backdrop);
        await refreshPersonModal(parentBackdrop, targetUserId, byId.get(targetUserId));
        openMetricEditModal(newGoalId, { metric_id: metricId, metric_unit: '', target_value: null, evaluation_operator: 'GTE' }, targetUserId, parentBackdrop, byId.get(targetUserId));
        return;
      }
      closeModal(backdrop);
      toast('บันทึกเป้าหมายเรียบร้อย');
      await refreshPersonModal(parentBackdrop, targetUserId, byId.get(targetUserId));
    } catch (err) { toast(err.message, 'error'); }
  };
}

function openMetricEditModal(goalId, metric, targetUserId, parentBackdrop, person) {
  const backdrop = openModal(`
    <h3 style="margin-top:0">${metric?.metric_id ? 'แก้ไขตัววัด' : 'เพิ่มตัววัดใหม่'}</h3>
    <div class="field-row">
      <div class="field"><label>ตัวชี้วัด (หน่วย)</label><input id="f-unit" value="${esc(metric?.metric_unit || '')}"></div>
      <div class="field"><label>ค่าเป้าหมาย</label><input id="f-target" type="number" step="0.01" value="${metric?.target_value ?? ''}"></div>
    </div>
    <div class="field">
      <label>เงื่อนไขบรรลุเป้า</label>
      <select id="f-operator">
        ${Object.entries(OPERATOR_LABEL_TH).map(([k, v]) => `<option value="${k}" ${(metric?.evaluation_operator || 'GTE') === k ? 'selected' : ''}>${v}</option>`).join('')}
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
      await api.upsertGoalMetric({
        metric_id: metric?.metric_id ?? null, goal_id: goalId,
        metric_unit: backdrop.querySelector('#f-unit').value.trim(),
        target_value: numOrNull(backdrop.querySelector('#f-target').value),
        evaluation_operator: backdrop.querySelector('#f-operator').value,
      });
      closeModal(backdrop);
      toast('บันทึกตัววัดเรียบร้อย');
      await refreshPersonModal(parentBackdrop, targetUserId, person);
    } catch (err) { toast(err.message, 'error'); }
  };
}

function openTacticEditModal(tactic, goalId, targetUserId, parentBackdrop, person) {
  const backdrop = openModal(`
    <h3 style="margin-top:0">${tactic ? 'แก้ไขทีเด็ด' : 'เพิ่มทีเด็ดใหม่'}</h3>
    <div class="field"><label>ชื่อทีเด็ด</label><input id="f-title" value="${esc(tactic?.tactic_title || '')}"></div>
    <div class="field"><label>รายละเอียดแผนปฏิบัติการ</label><textarea id="f-desc" rows="3">${esc(tactic?.action_plan_description || '')}</textarea></div>
    <div class="field">
      <label>ความถี่ในการรายงาน</label>
      <select id="f-freq">
        <option value="DAILY" ${(tactic?.frequency || 'WEEKLY') === 'DAILY' ? 'selected' : ''}>รายวัน</option>
        <option value="WEEKLY" ${(tactic?.frequency || 'WEEKLY') === 'WEEKLY' ? 'selected' : ''}>รายสัปดาห์</option>
        <option value="MONTHLY" ${(tactic?.frequency || 'WEEKLY') === 'MONTHLY' ? 'selected' : ''}>รายเดือน</option>
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
      await refreshPersonModal(parentBackdrop, targetUserId, person);
    } catch (err) { toast(err.message, 'error'); }
  };
}

function numOrNull(v) { return v === '' || v === null || v === undefined ? null : Number(v); }
