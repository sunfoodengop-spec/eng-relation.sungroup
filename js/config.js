// ============================================================================
// ตั้งค่าการเชื่อมต่อ Supabase
// วิธีหาค่า: Supabase Dashboard -> Project Settings -> API
//   - Project URL      -> ใส่ใน SUPABASE_URL
//   - anon public key   -> ใส่ใน SUPABASE_ANON_KEY  (ปลอดภัยที่จะฝังใน client
//     เพราะทุกตารางถูกล็อกด้วย RLS แบบ deny-all แล้ว เข้าถึงได้ทาง RPC เท่านั้น)
// ============================================================================
export const SUPABASE_URL = 'https://hbyjcslnxykktgtfimde.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhieWpjc2xueHlra3RndGZpbWRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0OTEyMTEsImV4cCI6MjEwMzA2NzIxMX0.v7ZKfsuqWWcXvI3LVMsNmaz2o1b6OdSqOQT7KALPymk';

export const APP_NAME = 'เป้าหมาย & Scoreboard';
export const CURRENT_YEAR = new Date().getFullYear() + 543; // ปี พ.ศ. สำหรับแสดงผล (ค.ศ. ใช้เก็บใน DB)
export const CURRENT_YEAR_CE = new Date().getFullYear();
