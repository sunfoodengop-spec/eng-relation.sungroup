// ============================================================================
// tacticPeriods.js — คำนวณ "งวด" ของทีเด็ดตามความถี่ (รายวัน/รายสัปดาห์/รายเดือน)
// ใช้ร่วมกันทั้งหน้า "เป้าหมาย & ทีเด็ด" (widget รายงานทำ/ไม่ทำ) และหน้า
// "Scoreboard" (สถิติทีเด็ดประจำเดือน)
// ============================================================================
export const FREQ_LABEL = { DAILY: 'รายวัน', WEEKLY: 'รายสัปดาห์', MONTHLY: 'รายเดือน' };

export function toISODate(d) { return d.toISOString().slice(0, 10); }

export function currentPeriodDate(freq) {
  const now = new Date();
  if (freq === 'DAILY') return toISODate(now);
  if (freq === 'MONTHLY') return toISODate(new Date(now.getFullYear(), now.getMonth(), 1));
  const day = now.getDay(); // 0=อาทิตย์..6=เสาร์ — สัปดาห์เริ่มวันจันทร์
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now); monday.setDate(now.getDate() + diffToMonday);
  return toISODate(monday);
}

export function stepPeriod(dateStr, freq, delta) {
  const d = new Date(dateStr + 'T00:00:00');
  if (freq === 'DAILY') d.setDate(d.getDate() + delta);
  else if (freq === 'MONTHLY') d.setMonth(d.getMonth() + delta);
  else d.setDate(d.getDate() + delta * 7);
  return toISODate(d);
}

export function periodLabel(dateStr, freq) {
  const d = new Date(dateStr + 'T00:00:00');
  if (freq === 'MONTHLY') return d.toLocaleDateString('th-TH', { year: '2-digit', month: 'short' });
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
}

// รายการวันเริ่มงวด (period_date) ทั้งหมดที่ "เริ่มต้น" อยู่ภายในเดือน/ปี (ค.ศ.)
// ที่กำหนด — ใช้คำนวณสถิติทีเด็ดรายเดือนในหน้า Scoreboard
export function periodsInMonth(freq, yearCE, monthNum) {
  const first = new Date(yearCE, monthNum - 1, 1);
  const last = new Date(yearCE, monthNum, 0); // วันสุดท้ายของเดือน
  const periods = [];

  if (freq === 'MONTHLY') {
    periods.push(toISODate(first));
    return periods;
  }
  if (freq === 'DAILY') {
    for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) periods.push(toISODate(d));
    return periods;
  }
  // WEEKLY: นับเฉพาะ "วันจันทร์" (วันเริ่มงวด) ที่ตกอยู่ในเดือนนี้จริง
  const d = new Date(first);
  const day = d.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  while (d <= last) {
    if (d.getMonth() === monthNum - 1) periods.push(toISODate(d));
    d.setDate(d.getDate() + 7);
  }
  return periods;
}
