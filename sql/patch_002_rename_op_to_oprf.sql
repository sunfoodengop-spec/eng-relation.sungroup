-- =============================================================================
-- patch_002_rename_op_to_oprf.sql
-- เปลี่ยนชื่อแผนก "OP" เป็น "OPRF" ทั้งระบบ (ตาราง departments + users.department)
-- รันได้ปลอดภัยซ้ำหลายครั้ง (idempotent) — รันที่ Supabase SQL Editor
-- =============================================================================

-- 1) ตาราง departments (ตัวเลือกใน Dropdown + หัวคอลัมน์ผังองค์กร)
update departments
set dept_key = 'OPRF', label = 'OPRF'
where dept_key = 'OP';

-- 2) users.department — บางคนมีค่าเดียว ('OP') บางคนมีหลายแผนกคั่นด้วย comma
--    (เช่น 'OP,SRN,ENF') ต้องแทนที่เฉพาะ token ที่ตรงกับ 'OP' เป๊ะๆ เท่านั้น
--    ไม่ไปแตะ 'ENF' หรือ 'SRN' ที่บังเอิญมีตัวอักษรใกล้เคียง
update users u
set department = t.new_department
from (
    select user_id,
        array_to_string(
            array(
                select case when trim(tag) = 'OP' then 'OPRF' else trim(tag) end
                from unnest(string_to_array(department, ',')) as tag
            ), ','
        ) as new_department
    from users
    where department is not null
      and department ~ '(^|,)\s*OP\s*(,|$)'
) t
where u.user_id = t.user_id;

-- 3) ตรวจสอบผล — ควรไม่พบแถวไหนเหลือ department ที่มี token 'OP' เดี่ยวๆ อีก
select user_id, emp_code, first_name, last_name, department
from users
where department ~ '(^|,)\s*OP\s*(,|$)';
