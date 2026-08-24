// ============================================================================
// pasteImport.js — วางข้อมูลจาก Excel/Google Sheet (คัดลอกมาแปะ) เพื่อกรอกเป้าหมาย
// / ทีเด็ด / Scoreboard ทีเดียวหลายแถว แทนการกรอกทีละช่องในฟอร์ม
//
// วิธีใช้จากหน้าอื่น:
//   import { openPasteImportModal } from '../pasteImport.js';
//   openPasteImportModal({
//     title, instructions, headers: ['คอลัมน์1','คอลัมน์2',...],
//     blankRows: [[..ค่าที่จะ prefill ในไฟล์ที่โหลด..], ...] (จะได้ไม่ต้องพิมพ์ชื่อซ้ำ),
//     filename: 'goals_template.csv',
//     onImport: async (rows) => ({ ok, fail, skip, total }) // rows = array ของ array
//   });
// ============================================================================
import { openModal, closeModal, toast } from './ui.js';

// Excel/Google Sheet คัดลอกมาเป็น tab-separated เสมอเวลาวางใน textarea ปกติ
export function parseTSV(text, headers) {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim() !== '');
  if (!lines.length) return [];
  let rows = lines.map(l => l.split('\t'));
  // ถ้าแถวแรกเป็นหัวตาราง (ตรงกับ headers ที่กำหนด) ให้ข้ามทิ้งอัตโนมัติ
  if (headers && rows[0].some((c, i) => c.trim() === (headers[i] || '').trim())) rows = rows.slice(1);
  return rows;
}

// ดาวน์โหลดไฟล์ .csv เปล่า (หรือ prefill บางส่วน) ให้ผู้ใช้เอาไปกรอกใน Excel
// ก่อนคัดลอกกลับมาวาง — ใส่ BOM (\uFEFF) กันปัญหาภาษาไทยเพี้ยนตอนเปิดด้วย Excel
export function downloadCSV(filename, headers, dataRows = []) {
  const escCsv = v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [headers.map(escCsv).join(','), ...dataRows.map(r => r.map(escCsv).join(','))];
  const csv = '\uFEFF' + lines.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export function openPasteImportModal({ title, instructions, headers, blankRows = [], filename, onImport }) {
  const backdrop = openModal(`
    <h3 style="margin-top:0">${title}</h3>
    <p class="text-muted" style="font-size:13px;margin-top:-4px">${instructions}</p>
    <div class="flex gap-8 mb-16">
      <button type="button" class="btn btn-sm" id="download-blank-btn">📥 โหลด Blank Form (.csv)</button>
    </div>
    <div class="field">
      <label>วางข้อมูลที่คัดลอกจาก Excel / Google Sheet ที่นี่</label>
      <textarea id="paste-area" rows="10" style="font-family:var(--font-mono);font-size:12px" placeholder="เปิดไฟล์ที่กรอกแล้ว เลือกข้อมูลทั้งหมด (รวมหัวตารางก็ได้ ระบบจะข้ามให้อัตโนมัติ) กด Ctrl+C แล้วมาคลิกที่นี่ กด Ctrl+V"></textarea>
    </div>
    <div id="paste-preview" class="text-dim" style="font-size:12px;margin:-6px 0 12px">ยังไม่มีข้อมูลที่วาง</div>
    <div class="flex gap-8" style="justify-content:flex-end">
      <button class="btn" id="cancel-btn">ยกเลิก</button>
      <button class="btn btn-primary" id="import-btn">นำเข้าข้อมูล</button>
    </div>
  `);

  backdrop.querySelector('#download-blank-btn').onclick = () => downloadCSV(filename, headers, blankRows);
  backdrop.querySelector('#cancel-btn').onclick = () => closeModal(backdrop);

  const textarea = backdrop.querySelector('#paste-area');
  const preview = backdrop.querySelector('#paste-preview');
  textarea.oninput = () => {
    const rows = parseTSV(textarea.value, headers);
    preview.textContent = rows.length ? `พบข้อมูล ${rows.length} แถวที่จะนำเข้า` : 'ยังไม่มีข้อมูลที่วาง';
  };

  backdrop.querySelector('#import-btn').onclick = async () => {
    const rows = parseTSV(textarea.value, headers);
    if (!rows.length) { toast('ยังไม่มีข้อมูลให้นำเข้า', 'error'); return; }
    const btn = backdrop.querySelector('#import-btn');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> กำลังนำเข้า...';
    try {
      const result = await onImport(rows);
      closeModal(backdrop);
      const parts = [`สำเร็จ ${result.ok ?? 0} รายการ`];
      if (result.skip) parts.push(`ข้าม ${result.skip} รายการ (ไม่พบข้อมูลอ้างอิง)`);
      if (result.fail) parts.push(`ผิดพลาด ${result.fail} รายการ`);
      toast(parts.join(' · '), result.fail ? 'error' : 'success');
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false; btn.textContent = 'นำเข้าข้อมูล';
    }
  };
}
