import { api } from '../api.js';
import { toast, openModal, closeModal, confirmDialog, escapeHtml as esc } from '../ui.js';

const LEVEL_LABEL = { 80: 'ผจก.ทั่วไป (GM)', 75: 'ผจก.ฝ่าย', 65: 'ผจก.ส่วน', 55: 'ผจก.แผนก', 40: 'วิศวกร/เจ้าหน้าที่' };
const ROLE_LABEL = { STAFF: 'เจ้าหน้าที่', SUPERVISOR: 'หัวหน้างาน', ADMIN: 'ผู้ดูแลระบบ' };

// ชื่อตำแหน่งมาตรฐานต่อระดับ แยกสายบริหาร (ผจก.) กับสายผู้ชำนาญการ — ระดับ 80
// (ผจก.ทั่วไป) มีได้แค่สายบริหารสายเดียว ไม่มีสายผู้ชำนาญการคู่ขนาน
const TRACK_TITLES = {
  80: { MGMT: 'ผู้จัดการทั่วไป' },
  75: { MGMT: 'ผู้จัดการฝ่าย', SPECIALIST: 'ผู้เชี่ยวชาญพิเศษ' },
  65: { MGMT: 'ผู้จัดการส่วน', SPECIALIST: 'ผู้เชี่ยวชาญ' },
  55: { MGMT: 'ผู้จัดการแผนก', SPECIALIST: 'ผู้ชำนาญการพิเศษ' },
  40: { MGMT: 'วิศวกร', SPECIALIST: 'ผู้ชำนาญการ' },
};
function buildPositionTitle(level, track, acting) {
  const base = (TRACK_TITLES[level] && TRACK_TITLES[level][track]) || TRACK_TITLES[level]?.MGMT || '';
  return (acting ? 'รักษาการ' : '') + base;
}
// เดาสาย/สถานะรักษาการจาก position_title เดิม (ตอนแก้ไขพนักงานที่มีอยู่แล้ว) —
// เทียบแบบ best-effort เพราะตำแหน่งเดิมบางอันมีชื่อแผนกต่อท้ายอยู่ด้วย
function guessTrackAndActing(title, level) {
  const t = title || '';
  const acting = t.includes('รักษาการ');
  const specialistLabel = TRACK_TITLES[level]?.SPECIALIST;
  const track = specialistLabel && t.includes(specialistLabel) ? 'SPECIALIST' : 'MGMT';
  return { track, acting };
}

let allUsers = [];
let allDepartments = []; // { department_id, dept_key, label, sort_order }

function deptLabelsOf(dept) {
  const keys = (dept || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!keys.length) return '-';
  return esc(keys.map(k => allDepartments.find(d => d.dept_key === k)?.label || k).join(' · '));
}

export async function render(container, { user }) {
  if (user.role !== 'ADMIN') {
    container.innerHTML = `<div class="card"><div class="empty-state"><div class="icon">🔒</div>หน้านี้สำหรับผู้ดูแลระบบเท่านั้น</div></div>`;
    return;
  }

  container.innerHTML = `
    <div class="flex-between mb-16">
      <div class="flex gap-8">
        <input id="search-box" placeholder="ค้นหาชื่อ, รหัสพนักงาน, ตำแหน่ง..." style="width:280px">
        <select id="dept-filter" style="width:180px"><option value="">ทุกแผนก</option></select>
      </div>
      <button class="btn btn-primary" id="add-user-btn">+ เพิ่มพนักงาน</button>
    </div>
    <div class="card"><div id="users-table"></div></div>
  `;

  document.getElementById('add-user-btn').onclick = () => openUserModal(null, container);
  document.getElementById('search-box').oninput = () => renderTable(currentFilters());
  document.getElementById('dept-filter').onchange = () => renderTable(currentFilters());

  await load(container);
}

function currentFilters() {
  return {
    text: document.getElementById('search-box').value.trim(),
    dept: document.getElementById('dept-filter').value,
  };
}

async function load(container) {
  document.getElementById('users-table').innerHTML = `<div class="loading-page"><span class="spinner"></span></div>`;
  [allUsers, allDepartments] = await Promise.all([
    api.getSubordinates(), // ADMIN role returns everyone
    api.listDepartments(),
  ]);
  const deptFilter = document.getElementById('dept-filter');
  const prevSelected = deptFilter.value;
  deptFilter.innerHTML = '<option value="">ทุกแผนก</option>' +
    allDepartments.map(d => `<option value="${esc(d.dept_key)}">${esc(d.label)}</option>`).join('');
  deptFilter.value = prevSelected; // คงตัวกรองเดิมไว้ถ้าเพิ่งบันทึก/แก้ไขพนักงานแล้วโหลดใหม่
  renderTable(currentFilters());
}

function renderTable({ text, dept }) {
  const wrap = document.getElementById('users-table');
  const f = (text || '').toLowerCase();
  const rows = allUsers.filter(u => {
    const matchesText = !f || `${u.first_name} ${u.last_name} ${u.emp_code} ${u.position_title}`.toLowerCase().includes(f);
    const userDepts = (u.department || '').split(',').map(s => s.trim());
    const matchesDept = !dept || userDepts.includes(dept);
    return matchesText && matchesDept;
  });

  if (!rows.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="icon">👥</div>ไม่พบพนักงานที่ตรงกับตัวกรอง</div>`;
    return;
  }

  wrap.innerHTML = `<table><thead><tr>
    <th>รหัสพนักงาน</th><th>ชื่อ-นามสกุล</th><th>ตำแหน่ง</th><th>แผนก</th><th>ระดับ</th><th>สิทธิ์</th><th>หัวหน้า</th><th></th>
  </tr></thead><tbody>
    ${rows.map(u => `
      <tr>
        <td class="text-muted">${esc(u.emp_code)}</td>
        <td>${esc(u.first_name)} ${esc(u.last_name)} ${u.nickname ? `<span class="text-dim">(${esc(u.nickname)})</span>` : ''}</td>
        <td>${esc(u.position_title)}</td>
        <td class="text-muted">${deptLabelsOf(u.department)}</td>
        <td>${LEVEL_LABEL[u.org_level] || u.org_level}</td>
        <td><span class="role-badge">${ROLE_LABEL[u.role] || u.role}</span></td>
        <td class="text-muted">${supervisorName(u.supervisor_id)}</td>
        <td class="flex gap-8">
          <button class="btn btn-sm" data-edit="${u.user_id}">แก้ไข</button>
          <button class="btn btn-sm" data-reset="${u.user_id}">รีเซ็ตรหัสผ่าน</button>
          <button class="btn btn-sm btn-danger" data-delete="${u.user_id}">ลบ</button>
        </td>
      </tr>
    `).join('')}
  </tbody></table>`;

  wrap.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openUserModal(allUsers.find(u => u.user_id == b.dataset.edit), document));
  wrap.querySelectorAll('[data-reset]').forEach(b => b.onclick = () => resetPassword(Number(b.dataset.reset)));
  wrap.querySelectorAll('[data-delete]').forEach(b => b.onclick = () => deleteUser(Number(b.dataset.delete), allUsers.find(u => u.user_id == b.dataset.delete)));
}

async function deleteUser(userId, u) {
  if (!(await confirmDialog(`ลบ "${u.first_name} ${u.last_name}" ออกจากระบบใช่หรือไม่? ลูกน้องโดยตรงของคนนี้จะถูกเลื่อนขึ้นไปอยู่ใต้ผู้บังคับบัญชาของเขาแทนโดยอัตโนมัติ (ประวัติเป้าหมาย/Scoreboard ที่เคยบันทึกไว้จะยังอยู่ครบ)`))) return;
  try {
    await api.deactivateUser(userId);
    toast('ลบพนักงานเรียบร้อย');
    await load();
  } catch (err) { toast(err.message, 'error'); }
}

function supervisorName(id) {
  const s = allUsers.find(u => u.user_id === id);
  return s ? `${s.first_name} ${s.last_name}` : '— (สูงสุด)';
}

async function resetPassword(userId) {
  if (!(await confirmDialog('ต้องการรีเซ็ตรหัสผ่านกลับเป็นรหัสพนักงานใช่หรือไม่? พนักงานจะต้องตั้งรหัสผ่านใหม่ในการเข้าสู่ระบบครั้งถัดไป'))) return;
  try {
    await api.adminResetPassword(userId);
    toast('รีเซ็ตรหัสผ่านเรียบร้อย');
  } catch (err) { toast(err.message, 'error'); }
}

function openUserModal(u, container) {
  const supervisorOptions = allUsers
    .filter(x => x.user_id !== u?.user_id)
    .map(x => `<option value="${x.user_id}" ${u?.supervisor_id === x.user_id ? 'selected' : ''}>${esc(x.first_name)} ${esc(x.last_name)} — ${esc(x.position_title)}</option>`)
    .join('');

  // แผนกที่คนนี้สังกัดอยู่แล้ว (รองรับหลายแผนก คั่นด้วย comma เช่น 'OPRF,SRN')
  const currentDeptKeys = (u?.department || '').split(',').map(s => s.trim()).filter(Boolean);

  const backdrop = openModal(`
    <h3 style="margin-top:0">${u ? 'แก้ไขพนักงาน' : 'เพิ่มพนักงานใหม่'}</h3>
    <div class="field"><label>รหัสพนักงาน</label><input id="f-code" value="${esc(u?.emp_code || '')}" ${u ? '' : 'placeholder="เช่น 443757 หรือ 123456 ถ้าไม่มีรหัส"'}></div>
    <div class="field-row">
      <div class="field"><label>ชื่อ</label><input id="f-fn" value="${esc(u?.first_name || '')}"></div>
      <div class="field"><label>นามสกุล</label><input id="f-ln" value="${esc(u?.last_name || '')}"></div>
    </div>
    <div class="field"><label>ชื่อเล่น</label><input id="f-nick" value="${esc(u?.nickname || '')}"></div>
    <div class="field-row">
      <div class="field"><label>ระดับชั้น</label>
        <select id="f-level">${Object.entries(LEVEL_LABEL).map(([k, v]) => `<option value="${k}" ${(u?.org_level ?? 40) == k ? 'selected' : ''}>${k} — ${v}</option>`).join('')}</select>
      </div>
      <div class="field"><label>สาย</label>
        <select id="f-track">
          <option value="MGMT">สายบริหาร (ผจก.แผนก/ส่วน/ฝ่าย)</option>
          <option value="SPECIALIST">สายผู้ชำนาญการ</option>
        </select>
      </div>
    </div>
    <div class="field">
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
        <input type="checkbox" id="f-acting" style="width:auto;margin:0"> รักษาการ
      </label>
    </div>
    <div class="field"><label>ตำแหน่ง (สร้างอัตโนมัติจากระดับ + สาย ด้านบน)</label><input id="f-pos-preview" disabled></div>
    <div class="field">
      <label>แผนก (เลือกได้มากกว่า 1 ถ้าคุมหลายแผนก)</label>
      <div id="dept-checklist" class="dept-checklist"></div>
      <div class="flex gap-8 mt-8">
        <input id="new-dept-name" placeholder="ชื่อแผนกใหม่..." style="flex:1">
        <button type="button" class="btn btn-sm" id="add-dept-btn">+ เพิ่มแผนก</button>
      </div>
    </div>
    <div class="field">
      <label>สิทธิ์การใช้งาน</label>
      <select id="f-role">${Object.entries(ROLE_LABEL).map(([k, v]) => `<option value="${k}" ${u?.role === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
    </div>
    <div class="field"><label>ผู้บังคับบัญชา (เว้นว่างถ้าเป็นตำแหน่งสูงสุด)</label>
      <select id="f-sup"><option value="">— ไม่มี (ตำแหน่งสูงสุด) —</option>${supervisorOptions}</select>
    </div>
    <div class="hint-box mb-16">รหัสผ่านเริ่มต้นของพนักงานใหม่ = รหัสพนักงาน (บังคับเปลี่ยนตอนล็อกอินครั้งแรก)</div>
    <div class="flex gap-8" style="justify-content:flex-end">
      <button class="btn" id="cancel-btn">ยกเลิก</button>
      <button class="btn btn-primary" id="save-btn">บันทึก</button>
    </div>
  `);

  renderDeptChecklist(backdrop, currentDeptKeys);

  // ---- ตำแหน่ง: สร้างอัตโนมัติจาก ระดับ + สาย + รักษาการ ------------------
  const levelSelect = backdrop.querySelector('#f-level');
  const trackSelect = backdrop.querySelector('#f-track');
  const actingCheckbox = backdrop.querySelector('#f-acting');
  const posPreview = backdrop.querySelector('#f-pos-preview');

  function refreshTrackOptionsAndPreview() {
    const level = Number(levelSelect.value);
    const hasSpecialistTrack = !!TRACK_TITLES[level]?.SPECIALIST;
    trackSelect.querySelector('option[value="SPECIALIST"]').disabled = !hasSpecialistTrack;
    if (!hasSpecialistTrack && trackSelect.value === 'SPECIALIST') trackSelect.value = 'MGMT';
    trackSelect.disabled = !hasSpecialistTrack;
    actingCheckbox.disabled = level >= 80; // ผจก.ทั่วไป ไม่มีสถานะรักษาการ
    if (level >= 80) actingCheckbox.checked = false;
    posPreview.value = buildPositionTitle(level, trackSelect.value, actingCheckbox.checked);
  }

  // ตั้งค่าเริ่มต้นจากตำแหน่งเดิม (ถ้าเป็นการแก้ไขพนักงานที่มีอยู่แล้ว)
  const initLevel = u?.org_level ?? 40;
  const { track: initTrack, acting: initActing } = guessTrackAndActing(u?.position_title, initLevel);
  trackSelect.value = initTrack;
  actingCheckbox.checked = initActing;
  refreshTrackOptionsAndPreview();

  levelSelect.onchange = refreshTrackOptionsAndPreview;
  trackSelect.onchange = refreshTrackOptionsAndPreview;
  actingCheckbox.onchange = refreshTrackOptionsAndPreview;

  backdrop.querySelector('#add-dept-btn').onclick = async () => {
    const input = backdrop.querySelector('#new-dept-name');
    const name = input.value.trim();
    if (!name) return;
    try {
      await api.upsertDepartment({ dept_key: name, label: name });
      allDepartments = await api.listDepartments();
      input.value = '';
      // แผนกที่เพิ่งเพิ่มใหม่ ให้ติ๊กเลือกให้อัตโนมัติ
      const selectedNow = getSelectedDeptKeys(backdrop);
      selectedNow.push(name);
      renderDeptChecklist(backdrop, selectedNow);
      toast('เพิ่มแผนกใหม่เรียบร้อย');
    } catch (err) { toast(err.message, 'error'); }
  };

  backdrop.querySelector('#cancel-btn').onclick = () => closeModal(backdrop);
  backdrop.querySelector('#save-btn').onclick = async () => {
    try {
      const sup = backdrop.querySelector('#f-sup').value;
      await api.upsertUser({
        user_id: u?.user_id ?? null,
        emp_code: backdrop.querySelector('#f-code').value.trim(),
        first_name: backdrop.querySelector('#f-fn').value.trim(),
        last_name: backdrop.querySelector('#f-ln').value.trim(),
        nickname: backdrop.querySelector('#f-nick').value.trim(),
        position_title: buildPositionTitle(Number(backdrop.querySelector('#f-level').value), backdrop.querySelector('#f-track').value, backdrop.querySelector('#f-acting').checked),
        department: getSelectedDeptKeys(backdrop).join(','),
        org_level: Number(backdrop.querySelector('#f-level').value),
        supervisor_id: sup ? Number(sup) : null,
        role: backdrop.querySelector('#f-role').value,
      });
      closeModal(backdrop);
      toast('บันทึกข้อมูลพนักงานเรียบร้อย');
      await load(container);
    } catch (err) { toast(err.message, 'error'); }
  };
}

function renderDeptChecklist(backdrop, selectedKeys) {
  const wrap = backdrop.querySelector('#dept-checklist');
  wrap.innerHTML = allDepartments.map(d => `
    <label class="dept-check-item">
      <input type="checkbox" value="${esc(d.dept_key)}" ${selectedKeys.includes(d.dept_key) ? 'checked' : ''}>
      ${esc(d.label)}
    </label>
  `).join('') || '<span class="text-dim" style="font-size:12px">ยังไม่มีแผนกในระบบ เพิ่มแผนกแรกด้านล่าง</span>';
}

function getSelectedDeptKeys(backdrop) {
  return [...backdrop.querySelectorAll('#dept-checklist input[type=checkbox]:checked')].map(el => el.value);
}
