// โหมดสว่าง/มืด — ใช้ localStorage เก็บค่าที่เลือกไว้ (คนละเครื่อง/เบราว์เซอร์
// จะจำแยกกัน) ค่าเริ่มต้นถ้าไม่เคยตั้งคือโหมดมืด (เหมือนเดิม)
const STORAGE_KEY = 'ui_theme'; // 'light' | 'dark'

export function getTheme() {
  try { return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark'; }
  catch { return 'dark'; }
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
}

export function setTheme(theme) {
  try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* ignore */ }
  applyTheme(theme);
}

export function toggleTheme() {
  const next = getTheme() === 'light' ? 'dark' : 'light';
  setTheme(next);
  return next;
}

// เรียกครั้งเดียวตอนโหลดหน้า (นอกเหนือจาก inline script กัน flash ใน <head>)
applyTheme(getTheme());

// ปุ่มสลับโหมด — ใช้ซ้ำได้ทั้งหน้า login และหน้าแอปหลัก
export function themeToggleButtonHtml() {
  const isLight = getTheme() === 'light';
  return `<button class="btn btn-ghost btn-icon" id="theme-toggle-btn" title="สลับโหมดสว่าง/มืด">${isLight ? '🌙' : '☀️'}</button>`;
}

export function wireThemeToggleButton(container = document) {
  const btn = container.querySelector('#theme-toggle-btn');
  if (!btn) return;
  btn.onclick = () => {
    const next = toggleTheme();
    btn.textContent = next === 'light' ? '🌙' : '☀️';
  };
}
