-- =============================================================================
-- patch_001_departments.sql
-- เพิ่มตาราง departments ให้ Admin จัดการรายชื่อแผนก (Dropdown) ได้เองจากหน้าเว็บ
-- แทนที่จะ hardcode ไว้ใน js/pages/org.js เหมือนเดิม
--
-- ความเข้ากันได้: users.department ยังเป็น varchar เดิม เก็บเป็น raw tag คั่นด้วย
-- comma สำหรับคนที่คุมมากกว่า 1 แผนก (เช่น 'OP,SRN,ENF') เหมือนเดิมทุกประการ —
-- ตาราง departments แค่เป็น "รายการตัวเลือก" ให้ dropdown เลือก ไม่ใช่ foreign key
-- บังคับ (เผื่อกรณี legacy data ที่ยังไม่ตรงกับตัวเลือกใน dropdown ก็ไม่พัง)
-- =============================================================================

create table if not exists departments (
    department_id  serial primary key,
    dept_key       varchar(100) unique not null,  -- ต้องตรงกับค่าที่เก็บใน users.department เป๊ะ
    label          varchar(150) not null,          -- ข้อความที่แสดงบน Dropdown / หัวคอลัมน์ผัง
    sort_order     int not null default 0,          -- ลำดับซ้าย->ขวาบนผังองค์กร
    created_at     timestamptz not null default now()
);

-- Seed รายชื่อแผนกปัจจุบันทั้ง 9 แผนก ตามลำดับที่ยืนยันแล้วในผัง ENG
insert into departments (dept_key, label, sort_order) values
    ('LMN1', 'LMN1', 1),
    ('LMN2', 'LMN2', 2),
    ('RD', 'RD', 3),
    ('OPRF', 'OPRF', 4),
    ('SRN', 'SRN', 5),
    ('ENF', 'ENF', 6),
    ('Prod SRN', 'Prod SRN', 7),
    ('พลังงาน', 'พลังงาน', 8),
    ('ASRS', 'ASRS', 9)
on conflict (dept_key) do nothing;

-- 8.1 รายชื่อแผนกทั้งหมด (ใครก็ตามที่ login แล้วเรียกได้ ใช้สร้าง Dropdown /
--     คอลัมน์ผังองค์กร)
create or replace function list_departments(p_session_token uuid)
returns table (department_id int, dept_key varchar, label varchar, sort_order int)
language plpgsql
security definer
as $$
begin
    perform _current_user_id(p_session_token); -- แค่ validate session ว่า login อยู่จริง
    return query select d.department_id, d.dept_key, d.label, d.sort_order
        from departments d order by d.sort_order, d.label;
end;
$$;

-- 8.2 เพิ่ม/แก้ไขแผนก — Admin เท่านั้น
create or replace function upsert_department(
    p_session_token uuid, p_department_id int, p_dept_key varchar,
    p_label varchar, p_sort_order int default null
)
returns int
language plpgsql
security definer
as $$
declare
    v_uid int; v_role user_role; v_id int; v_next_order int;
begin
    v_uid := _current_user_id(p_session_token);
    select u2.role into v_role from users u2 where u2.user_id = v_uid;
    if v_role <> 'ADMIN' then raise exception 'FORBIDDEN'; end if;

    if p_department_id is null then
        select coalesce(max(sort_order), 0) + 1 into v_next_order from departments;
        insert into departments (dept_key, label, sort_order)
            values (p_dept_key, p_label, coalesce(p_sort_order, v_next_order))
            returning department_id into v_id;
    else
        update departments set dept_key = p_dept_key, label = p_label,
            sort_order = coalesce(p_sort_order, sort_order)
            where department_id = p_department_id
            returning department_id into v_id;
    end if;
    return v_id;
exception
    when unique_violation then
        raise exception 'DEPARTMENT_KEY_EXISTS';
end;
$$;

grant execute on function list_departments(uuid) to anon, authenticated;
grant execute on function upsert_department(uuid, int, varchar, varchar, int) to anon, authenticated;
