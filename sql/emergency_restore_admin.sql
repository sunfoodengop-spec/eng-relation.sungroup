-- =============================================================================
-- emergency_restore_admin.sql
-- ใช้กรณีไม่มี ADMIN เหลืออยู่ในระบบเลย (Admin Lockout)
-- รันทีละก้อนใน Supabase Dashboard > SQL Editor (ห้ามรันผ่านแอป เพราะแอปไม่มี
-- session ที่มีสิทธิ์ ADMIN ให้ใช้แล้ว ต้องแก้ตรงฐานข้อมูลเท่านั้น)
-- =============================================================================

-- ขั้นที่ 1: ตรวจสอบสถานะปัจจุบัน — ดูว่ามีใคร role='ADMIN' และ is_active=true อยู่บ้าง
-- และเช็คว่า 900001 หายไปจริงไหม (ถ้า query คืนแถวว่าง = ไม่มี ADMIN ที่ active เลย)
select user_id, emp_code, first_name, last_name, role, is_active
from users
where role = 'ADMIN'
order by is_active desc;

-- ขั้นที่ 2: ตั้ง อัษฎาวุธ (620304) เป็น ADMIN โดยตรง (ข้าม RPC เพราะไม่มี session admin)
update users
set role = 'ADMIN'
where emp_code = '620304';

-- ขั้นที่ 3: ยืนยันผล — ควรเห็น 620304 เป็น ADMIN และ is_active = true
select user_id, emp_code, first_name, last_name, position_title, role, is_active
from users
where emp_code = '620304';

-- ขั้นที่ 4 (ถ้าจำเป็น): ถ้า 900001 ยังอยู่ในตารางแต่แค่ is_active = false (soft-deleted
-- ผ่านแอปตามปกติ) ปล่อยไว้แบบนั้นได้เลย ไม่ต้องกู้คืน — เพราะตอนนี้มี 620304 เป็น ADMIN
-- ตัวจริงแทนแล้ว ไม่จำเป็นต้องมี "สมชาย ผู้บริหาร" (บัญชีทดสอบตั้งต้น) อีกต่อไป
