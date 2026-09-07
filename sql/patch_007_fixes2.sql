-- =============================================================================
-- patch_007_fixes2.sql
-- แก้ 2 บั๊ก:
--   A) กราฟแนวโน้ม/กราฟแท่ง (หน้าภาพรวม + วิเคราะห์ผลงาน) ไม่ขึ้นเลย — เพราะตอน
--      ย้ายไปใช้ระบบตัววัดหลายตัว (patch_005) เส้น "เป้าหมาย" อิงจาก
--      sum(g.weight_percentage) ตรงๆ ถ้าเป้าหมายไหนไม่ได้กรอกน้ำหนักไว้ (null)
--      จะทำให้ผลรวมทั้งเดือนกลายเป็น null ไปด้วย (null มากับอะไรก็ null) เมื่อทุก
--      เดือนเป็น null หมด กราฟเลยไม่มีจุดให้วาดเลย — เปลี่ยนเป็นเส้นเป้าหมายคงที่
--      100% เสมอ (ไม่พึ่งพาน้ำหนักที่อาจว่าง) และกัน null ของเส้นผลงานจริงด้วย
--      coalesce ให้เป็น 0 แทน
--   B) ผังองค์กร — เปิดให้ "ทุกคนดูได้ทั้งหมดทุกคนในบริษัท" ไม่จำกัดแค่แผนกตัวเอง
--      อีกต่อไป (เดิม patch_004 จำกัดไว้แค่แผนกเดียวกัน) — สิทธิ์แก้ไขเป้าหมาย/
--      ทีเด็ด/Scoreboard ยังคงเดิม (ADMIN หรือ same-dept+higher-level) ไม่เปลี่ยน
--      แค่ "มองเห็น" ในผังเท่านั้นที่เปิดกว้างขึ้น
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A) get_individual_analytics — เส้นเป้าหมายคงที่ 100% กันปัญหาน้ำหนักว่าง
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
                       100::decimal as weighted_target,
                       round(sum(coalesce(_goal_overall_achievement(g.goal_id, mn.month_num),0) * coalesce(g.weight_percentage,0)/100),2) as weighted_actual
                from goals g
                cross join generate_series(1,12) as mn(month_num)
                where g.year = p_year and g.is_active = true
                  and (g.user_id = p_target_user_id
                       or exists (select 1 from goal_co_owners co where co.goal_id = g.goal_id and co.holder_user_id = p_target_user_id))
                group by mn.month_num
            ) x
        ),
        'overall_achievement', (
            select round(avg(ov),2) from (
                select distinct g.goal_id, mn.month_num, _goal_overall_achievement(g.goal_id, mn.month_num) as ov
                from goals g cross join generate_series(1,12) as mn(month_num)
                where g.year = p_year and g.is_active = true
                  and (g.user_id = p_target_user_id
                       or exists (select 1 from goal_co_owners co where co.goal_id = g.goal_id and co.holder_user_id = p_target_user_id))
            ) y where ov is not null
        ),
        'tactics_progress', (
            select coalesce(json_agg(json_build_object(
                'tactic_title', t.tactic_title, 'goal_title', g.goal_title, 'frequency', t.frequency,
                'goal_achievement', (
                    select round(avg(_goal_overall_achievement(g.goal_id, mn.month_num)),2)
                    from generate_series(1,12) as mn(month_num)
                    where _goal_overall_achievement(g.goal_id, mn.month_num) is not null
                ))), '[]'::json)
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
-- B) get_org_chart — ทุกคนเห็นทุกคนในบริษัท ไม่จำกัดแค่แผนกตัวเองแล้ว
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
begin
    v_uid := _current_user_id(p_session_token); -- แค่ validate ว่า login อยู่จริง
    return query select u.user_id, u.emp_code, u.first_name, u.last_name, u.nickname, u.position_title,
        u.department, u.org_level, u.supervisor_id, u.avatar_url, u.role
        from users u where u.is_active = true;
end;
$$;
