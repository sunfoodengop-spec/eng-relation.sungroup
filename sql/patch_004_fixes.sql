-- =============================================================================
-- patch_004_fixes.sql
-- แก้ 3 บั๊กที่พบจากการใช้งานจริง:
--   1) get_org_chart error "column reference department is ambiguous"
--      (เกิดจาก RETURNS TABLE มีคอลัมน์ชื่อ department ชนกับตัวแปรใน query ที่ไม่ใส่
--       table alias — ต้อง qualify ให้ครบทุกจุด)
--   2) "ผู้ใช้งานไม่สามารถดูผังองค์กรได้ ให้ทุกคนดูได้ทั้งแผนก" — เดิม patch_003
--      เปิดให้เห็นคนแผนกเดียวกันเฉพาะ role SUPERVISOR เท่านั้น ตอนนี้เปิดให้ทุก role
--      (รวม STAFF) เห็นคนแผนกเดียวกันทั้งหมดในผังองค์กรด้วย (มองเห็นอย่างเดียว
--      สิทธิ์แก้ไขเป้าหมาย/ทีเด็ด/Scoreboard ยังจำกัดที่ ADMIN/SUPERVISOR เหมือนเดิม)
--   3) ลบเป้าหมายแล้ว "ทีเด็ด/ความคืบหน้า" ยังค้างอยู่หน้าภาพรวม — เพราะ delete_goal
--      soft-delete แค่ตัวเป้าหมาย ไม่ได้ soft-delete ทีเด็ดที่แขวนอยู่ใต้ตามที่ UI
--      สัญญาไว้ ("ทีเด็ดภายใต้เป้าหมายนี้จะถูกลบไปด้วย") และ get_individual_analytics
--      ส่วน tactics_progress ก็ไม่ได้เช็คว่าเป้าหมายแม่ยัง active อยู่ไหมด้วย
--
-- รันได้ปลอดภัยซ้ำหลายครั้ง (idempotent) — รันที่ Supabase SQL Editor
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Fix 1 + 2: get_org_chart
-- ---------------------------------------------------------------------------
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

    -- แก้ Fix 1: ใส่ table alias (u3.department) ให้ครบ กัน ambiguous กับคอลัมน์
    -- ผลลัพธ์ชื่อ "department" ที่มาจาก RETURNS TABLE ของฟังก์ชันนี้เอง
    select string_to_array(coalesce(u3.department, ''), ',') into v_my_depts
        from users u3 where u3.user_id = v_uid;

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
    same_dept as ( -- แก้ Fix 2: ทุก role (ไม่ใช่แค่ SUPERVISOR) เห็นคนแผนกเดียวกันทั้งหมด
        select u.* from users u
        where exists (
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

-- ---------------------------------------------------------------------------
-- Fix 3a: delete_goal ต้อง cascade ปิดทีเด็ดใต้เป้าหมายนั้นด้วย ตามที่ UI สัญญาไว้
-- ---------------------------------------------------------------------------
create or replace function delete_goal(p_session_token uuid, p_goal_id int)
returns boolean
language plpgsql
security definer
as $$
declare
    v_uid int; v_role user_role; v_owner int;
begin
    v_uid := _current_user_id(p_session_token);
    select u2.role into v_role from users u2 where u2.user_id = v_uid;
    select user_id into v_owner from goals where goal_id = p_goal_id;
    if not _can_manage(v_uid, v_role, v_owner) then raise exception 'FORBIDDEN'; end if;
    update goals set is_active = false where goal_id = p_goal_id;
    update tactics set is_active = false where goal_id = p_goal_id;
    return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fix 3b: get_individual_analytics — tactics_progress ต้องเช็คด้วยว่าเป้าหมายแม่
-- (g.is_active) ยังไม่ถูกลบ ไม่ใช่เช็คแค่ตัวทีเด็ด (t.is_active) อย่างเดียว
-- ---------------------------------------------------------------------------
create or replace function get_individual_analytics(p_session_token uuid, p_target_user_id int, p_year int)
returns json
language plpgsql
security definer
as $$
declare
    v_uid int; v_role user_role; v_result json;
begin
    v_uid := _current_user_id(p_session_token);
    select u2.role into v_role from users u2 where u2.user_id = v_uid;
    if not _can_manage(v_uid, v_role, p_target_user_id) then raise exception 'FORBIDDEN'; end if;

    select json_build_object(
        'monthly', (
            select coalesce(json_agg(x order by x.month_num), '[]'::json) from (
                select mn.month_num,
                       round(sum(g.target_value * g.weight_percentage/100),2) as weighted_target,
                       round(sum(coalesce(s.actual_val,0) * g.weight_percentage/100),2) as weighted_actual
                from goals g
                cross join generate_series(1,12) as mn(month_num)
                left join scoreboard_monthly s on s.goal_id = g.goal_id and s.month_num = mn.month_num
                where g.year = p_year and g.is_active = true
                  and (g.user_id = p_target_user_id
                       or exists (select 1 from goal_co_owners co where co.goal_id = g.goal_id and co.holder_user_id = p_target_user_id))
                group by mn.month_num
            ) x
        ),
        'overall_achievement', (
            select round(avg(_calc_achievement_pct(g.target_value, s.actual_val, g.evaluation_operator)),2)
            from goals g join scoreboard_monthly s on s.goal_id = g.goal_id
            where g.year = p_year and g.is_active = true and s.actual_val is not null
              and (g.user_id = p_target_user_id
                   or exists (select 1 from goal_co_owners co where co.goal_id = g.goal_id and co.holder_user_id = p_target_user_id))
        ),
        'tactics_progress', (
            select coalesce(json_agg(json_build_object(
                'tactic_title', t.tactic_title, 'goal_title', g.goal_title,
                'goal_achievement', (select round(avg(_calc_achievement_pct(g.target_value, s2.actual_val, g.evaluation_operator)),2)
                    from scoreboard_monthly s2 where s2.goal_id = g.goal_id and s2.actual_val is not null))), '[]'::json)
            from tactics t join goals g on g.goal_id = t.goal_id
            where g.year = p_year and g.is_active = true and t.is_active = true
              and (g.user_id = p_target_user_id
                   or exists (select 1 from goal_co_owners co where co.goal_id = g.goal_id and co.holder_user_id = p_target_user_id))
        )
    ) into v_result;

    return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fix 3c: เก็บกวาดข้อมูลที่ค้างอยู่แล้วในฐานข้อมูลตอนนี้ทันที (ทีเด็ดที่เป้าหมาย
-- แม่ถูกลบไปแล้วแต่ตัวทีเด็ดเองยัง is_active=true ค้างอยู่ — ปิดให้หมดในคราวเดียว)
-- ---------------------------------------------------------------------------
update tactics t
set is_active = false
from goals g
where t.goal_id = g.goal_id and g.is_active = false and t.is_active = true;
