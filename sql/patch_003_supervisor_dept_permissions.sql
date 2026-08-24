-- =============================================================================
-- patch_003_supervisor_dept_permissions.sql
-- ขยายสิทธิ์ "หัวหน้างาน" (role = SUPERVISOR): นอกจากจะแก้ไขเป้าหมาย/ทีเด็ด/
-- Scoreboard ของลูกน้องตรงสาย (supervisor_id chain) ได้แล้ว ตอนนี้ยังแก้ไขได้
-- สำหรับ "ใครก็ตามที่อยู่แผนกเดียวกัน และมีระดับ (org_level) ต่ำกว่าตัวเอง" ด้วย
-- แม้จะไม่ได้อยู่ในสายบังคับบัญชาตรงก็ตาม — และมองเห็นคนเหล่านั้นในหน้าผังองค์กร
-- ได้ด้วย (ไม่งั้นจะเห็นแต่ปุ่มแก้ไขที่กดไม่ได้เพราะมองไม่เห็นคนในผังอยู่ดี)
--
-- ไม่กระทบ: สิทธิ์แก้ไขข้อมูลพนักงาน (upsert_user) และลบพนักงาน (deactivate_user)
-- ยังคงจำกัดเฉพาะ ADMIN หรือสายบังคับบัญชาตรงเหมือนเดิมทุกประการ — patch นี้แก้
-- เฉพาะสิทธิ์เป้าหมาย/ทีเด็ด/Scoreboard และการมองเห็นในผังองค์กรเท่านั้น
-- รันได้ปลอดภัยซ้ำหลายครั้ง (idempotent, ใช้ create or replace ทั้งหมด)
-- =============================================================================

-- แผนกเดียวกัน (มี dept tag ทับซ้อนกันอย่างน้อย 1 แผนก) และ p_uid มีระดับสูงกว่า
-- p_target อย่างเคร่งครัด — department เก็บเป็น comma-separated string รองรับ
-- คนที่คุมหลายแผนก (เช่น 'OPRF,SRN,ENF') อยู่แล้ว
create or replace function _same_dept_higher_level(p_uid int, p_target int)
returns boolean
language plpgsql
security definer
as $$
declare
    v_uid_level int; v_target_level int;
    v_uid_depts varchar[]; v_target_depts varchar[];
begin
    select org_level, string_to_array(coalesce(department, ''), ',')
        into v_uid_level, v_uid_depts from users where user_id = p_uid;
    select org_level, string_to_array(coalesce(department, ''), ',')
        into v_target_level, v_target_depts from users where user_id = p_target;

    if v_uid_level is null or v_target_level is null then return false; end if;
    if v_uid_level <= v_target_level then return false; end if;

    return exists (
        select 1 from unnest(v_uid_depts) a
        join unnest(v_target_depts) b on trim(a) = trim(b) and trim(a) <> ''
    );
end;
$$;

-- 4.3 ตรวจสิทธิ์จัดการเป้าหมาย/ทีเด็ด/Scoreboard — เพิ่มเงื่อนไข same-dept +
-- higher-level เป็นอีกหนึ่งเส้นทางที่ทำให้ SUPERVISOR จัดการได้ (นอกจาก ADMIN,
-- ตัวเอง, และสายบังคับบัญชาตรงเดิม)
create or replace function _can_manage(p_uid int, p_role user_role, p_target int)
returns boolean
language plpgsql
security definer
as $$
begin
    if p_role = 'ADMIN' then return true; end if;
    if p_uid = p_target then return true; end if;
    if p_role = 'SUPERVISOR' and _is_supervisor_of(p_uid, p_target) then return true; end if;
    if p_role = 'SUPERVISOR' and _same_dept_higher_level(p_uid, p_target) then return true; end if;
    return false;
end;
$$;

-- 6.2 ผังองค์กร — SUPERVISOR มองเห็นเพิ่มเติม: คนแผนกเดียวกันทั้งหมด (ไม่ใช่แค่
-- สายบังคับบัญชาตรงของตัวเอง) เพื่อให้เห็นครบทั้งคอลัมน์แผนกเหมือน ADMIN เห็น
-- และเพื่อให้กดเข้าไปแก้ไขเป้าหมายของคนแผนกเดียวกันระดับต่ำกว่าได้จริงตามสิทธิ์ใหม่
create or replace function get_org_chart(p_session_token uuid)
returns table (
    user_id int, emp_code varchar, first_name varchar, last_name varchar, nickname varchar,
    position_title varchar, department varchar, org_level smallint,
    supervisor_id int, avatar_url text, role user_role
)
language plpgsql
security definer
as $$
declare
    v_uid int;
    v_role user_role;
    v_my_depts varchar[];
begin
    v_uid := _current_user_id(p_session_token);
    select u2.role into v_role from users u2 where u2.user_id = v_uid;

    if v_role = 'ADMIN' then
        return query select u.user_id, u.emp_code, u.first_name, u.last_name, u.nickname, u.position_title,
            u.department, u.org_level, u.supervisor_id, u.avatar_url, u.role
            from users u where u.is_active = true;
        return;
    end if;

    select string_to_array(coalesce(department, ''), ',') into v_my_depts from users where user_id = v_uid;

    return query
    with recursive up as ( -- ตัวเองและสายบังคับบัญชาด้านบน
        select u.* from users u where u.user_id = v_uid
        union all
        select u.* from users u join up on u.user_id = up.supervisor_id
    ),
    down as ( -- ลูกน้องทุกระดับ (ทางสายตรง)
        select u.* from users u where u.supervisor_id = v_uid
        union all
        select u.* from users u join down d on u.supervisor_id = d.user_id
    ),
    same_dept as ( -- คนแผนกเดียวกันทั้งหมด (เฉพาะ SUPERVISOR ถึงจะเห็นกลุ่มนี้เพิ่ม)
        select u.* from users u
        where v_role = 'SUPERVISOR' and exists (
            select 1 from unnest(string_to_array(coalesce(u.department, ''), ',')) a
            join unnest(v_my_depts) b on trim(a) = trim(b) and trim(a) <> ''
        )
    )
    select x.user_id, x.emp_code, x.first_name, x.last_name, x.nickname, x.position_title,
           x.department, x.org_level, x.supervisor_id, x.avatar_url, x.role
    from (select * from up union select * from down union select * from same_dept) x
    where x.is_active = true;
end;
$$;
