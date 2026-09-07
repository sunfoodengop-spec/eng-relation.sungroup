-- =============================================================================
-- patch_005_multi_metric_and_checkins.sql
-- การเปลี่ยนแปลงใหญ่ 2 เรื่อง:
--
--   A) เป้าหมาย 1 เป้า มีได้มากกว่า 1 "ตัววัด" (goal_metrics) — แต่ละตัววัดมี
--      หน่วย/ค่าเป้าหมาย/เงื่อนไขของตัวเอง บันทึกผลจริงแยกรายตัววัดรายเดือน
--      ตอนประเมินผ่าน/ไม่ผ่านของทั้งเป้าหมาย ใช้ "ตัววัดที่แย่ที่สุด" (กติกาเข้มสุด
--      ที่ยังไม่ผ่าน) เป็นตัวชี้ขาด — ถ้าตัววัดใดตัวหนึ่งยังไม่ผ่าน ทั้งเป้าหมายถือว่า
--      ยังไม่ผ่านตามตัวนั้น
--
--   B) ทีเด็ดต้องระบุความถี่ (รายวัน/รายสัปดาห์/รายเดือน) และมีการรายงาน
--      "ทำ/ไม่ทำ" ตามงวดนั้นๆ (tactic_checkins)
--
-- ⚠️ นี่คือการเปลี่ยนโครงสร้างข้อมูลเป้าหมาย/Scoreboard ครั้งใหญ่ที่สุดของระบบ —
-- ต้องรันตามลำดับในไฟล์นี้ทั้งหมดรวดเดียว (ไม่ต้องรันทีละส่วน) และต้องอัปเดต
-- โค้ดฝั่งเว็บ (js/) เป็นเวอร์ชันใหม่พร้อมกันเสมอ มิฉะนั้นหน้าเว็บเก่าจะเรียก RPC
-- ด้วยพารามิเตอร์ที่ไม่ตรงกับฟังก์ชันใหม่นี้แล้วพัง
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A.1: ตาราง goal_metrics — ตัววัดของเป้าหมาย (1 เป้าหมาย มีได้หลายตัววัด)
-- ---------------------------------------------------------------------------
create table if not exists goal_metrics (
    metric_id           serial primary key,
    goal_id             int not null references goals(goal_id) on delete cascade,
    metric_unit         varchar(50),
    target_value        decimal(10,2),
    evaluation_operator eval_operator not null default 'GTE',
    sort_order          int not null default 0,
    created_at          timestamptz not null default now()
);
create index if not exists idx_goal_metrics_goal on goal_metrics(goal_id);

-- ย้ายตัววัดเดิมของทุกเป้าหมาย (คอลัมน์เดี่ยวบน goals) มาเป็นแถวแรก (metric #1)
-- ในตารางใหม่ — ทำครั้งเดียว ข้ามถ้าเป้าหมายนั้นมี metric อยู่แล้ว (idempotent)
insert into goal_metrics (goal_id, metric_unit, target_value, evaluation_operator, sort_order)
select g.goal_id, g.metric_unit, g.target_value, g.evaluation_operator, 0
from goals g
where not exists (select 1 from goal_metrics gm where gm.goal_id = g.goal_id);

-- ---------------------------------------------------------------------------
-- A.2: scoreboard_monthly ย้ายจากอ้างอิง goal_id ตรงๆ เป็นอ้างอิง metric_id
-- (ผลจริงบันทึกแยกรายตัววัด ไม่ใช่รายเป้าหมายเหมือนเดิม)
-- ---------------------------------------------------------------------------
alter table scoreboard_monthly add column if not exists metric_id int references goal_metrics(metric_id) on delete cascade;

-- ย้ายผลจริงเดิมไปแขวนกับ metric #1 (sort_order=0) ของเป้าหมายเดิมแต่ละอัน
update scoreboard_monthly s
set metric_id = gm.metric_id
from goal_metrics gm
where s.metric_id is null and s.goal_id = gm.goal_id and gm.sort_order = 0;

-- ทำความสะอาดคอลัมน์/constraint เก่าที่อ้างอิง goal_id โดยตรง (ถ้ายังไม่เคยลบ)
do $$
begin
    if exists (select 1 from information_schema.table_constraints
               where table_name = 'scoreboard_monthly' and constraint_name = 'scoreboard_monthly_goal_id_month_num_key') then
        alter table scoreboard_monthly drop constraint scoreboard_monthly_goal_id_month_num_key;
    end if;
    if exists (select 1 from information_schema.columns
               where table_name = 'scoreboard_monthly' and column_name = 'goal_id') then
        alter table scoreboard_monthly drop column goal_id;
    end if;
end $$;

alter table scoreboard_monthly alter column metric_id set not null;
create unique index if not exists uq_scoreboard_metric_month on scoreboard_monthly(metric_id, month_num);
create index if not exists idx_scoreboard_metric on scoreboard_monthly(metric_id);

-- ---------------------------------------------------------------------------
-- B.1: ทีเด็ดต้องระบุความถี่ + ตาราง check-in ทำ/ไม่ทำตามงวด
-- ---------------------------------------------------------------------------
do $$ begin
    create type tactic_frequency as enum ('DAILY', 'WEEKLY', 'MONTHLY');
exception when duplicate_object then null;
end $$;

alter table tactics add column if not exists frequency tactic_frequency not null default 'WEEKLY';

-- period_date = วันเริ่มของงวดนั้น (รายวัน = วันนั้นเอง, รายสัปดาห์ = วันจันทร์
-- ของสัปดาห์นั้น, รายเดือน = วันที่ 1 ของเดือนนั้น) — ฝั่งเว็บเป็นคนคำนวณวันแล้วส่งมา
create table if not exists tactic_checkins (
    checkin_id   serial primary key,
    tactic_id    int not null references tactics(tactic_id) on delete cascade,
    period_date  date not null,
    done         boolean not null,
    notes        text,
    checked_by   int references users(user_id),
    checked_at   timestamptz not null default now(),
    unique (tactic_id, period_date)
);
create index if not exists idx_tactic_checkins_tactic on tactic_checkins(tactic_id);

-- ---------------------------------------------------------------------------
-- Helper: ตัววัดที่ "แย่ที่สุด" ของเป้าหมายหนึ่งๆ ในเดือนหนึ่งๆ (กติกาเข้มสุด
-- ที่ยังไม่ผ่าน เป็นตัวชี้ขาดว่าทั้งเป้าหมายผ่านหรือไม่) — พิจารณาเฉพาะตัววัดที่
-- มีการกรอกผลจริงแล้วในเดือนนั้น (ตัวที่ยังไม่กรอกไม่นับ ไม่ทำให้ค่าตกไปด้วย)
-- ---------------------------------------------------------------------------
create or replace function _goal_overall_status(p_goal_id int, p_month_num int)
returns status_color
language plpgsql
security definer
as $$
declare
    v_worst status_color;
begin
    select sc into v_worst from (
        select _calc_status_color(gm.target_value, s.actual_val, gm.evaluation_operator) as sc,
               case _calc_status_color(gm.target_value, s.actual_val, gm.evaluation_operator)
                    when 'RED' then 1 when 'YELLOW' then 2 when 'GREEN' then 3 else 4 end as rnk
        from goal_metrics gm
        join scoreboard_monthly s on s.metric_id = gm.metric_id and s.month_num = p_month_num
        where gm.goal_id = p_goal_id and s.actual_val is not null
    ) x
    order by rnk asc
    limit 1;
    return v_worst;
end;
$$;

create or replace function _goal_overall_achievement(p_goal_id int, p_month_num int)
returns decimal
language plpgsql
security definer
as $$
declare v_pct decimal;
begin
    select min(_calc_achievement_pct(gm.target_value, s.actual_val, gm.evaluation_operator))
    into v_pct
    from goal_metrics gm
    join scoreboard_monthly s on s.metric_id = gm.metric_id and s.month_num = p_month_num
    where gm.goal_id = p_goal_id and s.actual_val is not null;
    return v_pct;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7.1 list_goals — เป้าหมาย + ตัววัดหลายตัว (metrics[]) + ทีเด็ดพร้อมความถี่
-- ⚠️ คอลัมน์ผลลัพธ์เปลี่ยนไปจากเดิม (ตัด metric_unit/target_value/evaluation_operator
-- ออก เพิ่ม metrics json แทน) — Postgres ไม่ยอมให้ CREATE OR REPLACE เปลี่ยน
-- return type ของฟังก์ชันเดิมได้ ต้อง DROP ก่อนเสมอ (ปลอดภัยแม้ยังไม่เคยมีฟังก์ชันนี้)
-- ---------------------------------------------------------------------------
drop function if exists list_goals(uuid, int, int);
create or replace function list_goals(p_session_token uuid, p_target_user_id int, p_year int)
returns table (
    goal_id int, goal_title text, weight_percentage decimal, parent_goal_id int,
    is_shared boolean, owner_name text, metrics json, tactics json
)
language plpgsql
security definer
as $$
declare
    v_uid int; v_role user_role;
begin
    v_uid := _current_user_id(p_session_token);
    select u2.role into v_role from users u2 where u2.user_id = v_uid;
    if not _can_manage(v_uid, v_role, p_target_user_id) then
        raise exception 'FORBIDDEN';
    end if;

    return query
    select g.goal_id, g.goal_title, g.weight_percentage, g.parent_goal_id,
           (g.user_id <> p_target_user_id) as is_shared,
           case when g.user_id <> p_target_user_id
                then (select ou.first_name || ' ' || ou.last_name from users ou where ou.user_id = g.user_id)
                else null end as owner_name,
           coalesce((select json_agg(json_build_object(
                'metric_id', gm.metric_id, 'metric_unit', gm.metric_unit,
                'target_value', gm.target_value, 'evaluation_operator', gm.evaluation_operator,
                'sort_order', gm.sort_order) order by gm.sort_order, gm.metric_id)
             from goal_metrics gm where gm.goal_id = g.goal_id), '[]'::json) as metrics,
           coalesce((select json_agg(json_build_object(
                'tactic_id', t.tactic_id, 'tactic_title', t.tactic_title,
                'action_plan_description', t.action_plan_description,
                'frequency', t.frequency,
                'adopted_from_tactic_id', t.adopted_from_tactic_id))
             from tactics t where t.goal_id = g.goal_id and t.is_active = true), '[]'::json) as tactics
    from goals g
    where g.is_active = true and g.year = p_year
      and (g.user_id = p_target_user_id
           or exists (select 1 from goal_co_owners co where co.goal_id = g.goal_id and co.holder_user_id = p_target_user_id))
    order by g.goal_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7.2 upsert_goal — ตอนนี้จัดการแค่ระดับเป้าหมาย (ชื่อ/น้ำหนัก/ปี/ลิงก์เป้าแม่)
-- ตัววัดแยกไปจัดการที่ upsert_goal_metric/delete_goal_metric แทน
-- ⚠️ พารามิเตอร์เปลี่ยน (ตัด p_metric_unit/p_target_value/p_evaluation_operator
-- ออก) — ต้อง DROP ฟังก์ชันเดิมตามชนิดพารามิเตอร์เป๊ะๆ ก่อน ไม่งั้น Postgres จะ
-- มองเป็นฟังก์ชันคนละตัว (overload) แล้วเรียกผ่าน RPC จะกำกวมว่าจะใช้ตัวไหน
-- ---------------------------------------------------------------------------
drop function if exists upsert_goal(uuid, int, int, text, varchar, decimal, decimal, int, int, eval_operator);
create or replace function upsert_goal(
    p_session_token uuid, p_goal_id int, p_target_user_id int, p_goal_title text,
    p_weight_percentage decimal, p_year int, p_parent_goal_id int
)
returns int
language plpgsql
security definer
as $$
declare
    v_uid int; v_role user_role; v_id int;
begin
    v_uid := _current_user_id(p_session_token);
    select u2.role into v_role from users u2 where u2.user_id = v_uid;
    if not _can_manage(v_uid, v_role, p_target_user_id) then raise exception 'FORBIDDEN'; end if;

    if p_goal_id is null then
        insert into goals (user_id, goal_title, weight_percentage, year, parent_goal_id)
        values (p_target_user_id, p_goal_title, p_weight_percentage, p_year, p_parent_goal_id)
        returning goal_id into v_id;
    else
        update goals set goal_title = p_goal_title, weight_percentage = p_weight_percentage
        where goal_id = p_goal_id returning goal_id into v_id;
    end if;
    return v_id;
end;
$$;

-- 7.2b เพิ่ม/แก้ไขตัววัดของเป้าหมาย (1 เป้าหมายเรียกได้หลายครั้งเพื่อมีหลายตัววัด)
create or replace function upsert_goal_metric(
    p_session_token uuid, p_metric_id int, p_goal_id int, p_metric_unit varchar,
    p_target_value decimal, p_evaluation_operator eval_operator default 'GTE', p_sort_order int default 0
)
returns int
language plpgsql
security definer
as $$
declare
    v_uid int; v_role user_role; v_owner int; v_id int;
begin
    v_uid := _current_user_id(p_session_token);
    select u2.role into v_role from users u2 where u2.user_id = v_uid;
    select user_id into v_owner from goals where goal_id = p_goal_id;
    if not _can_manage(v_uid, v_role, v_owner) then raise exception 'FORBIDDEN'; end if;

    if p_metric_id is null then
        insert into goal_metrics (goal_id, metric_unit, target_value, evaluation_operator, sort_order)
        values (p_goal_id, p_metric_unit, p_target_value, coalesce(p_evaluation_operator, 'GTE'), coalesce(p_sort_order, 0))
        returning metric_id into v_id;
    else
        update goal_metrics set metric_unit = p_metric_unit, target_value = p_target_value,
            evaluation_operator = coalesce(p_evaluation_operator, evaluation_operator),
            sort_order = coalesce(p_sort_order, sort_order)
        where metric_id = p_metric_id returning metric_id into v_id;
    end if;
    return v_id;
end;
$$;

-- 7.2c ลบตัววัด (เป้าหมายต้องเหลืออย่างน้อย 1 ตัววัดเสมอ ห้ามลบตัวสุดท้าย)
create or replace function delete_goal_metric(p_session_token uuid, p_metric_id int)
returns boolean
language plpgsql
security definer
as $$
declare
    v_uid int; v_role user_role; v_owner int; v_goal_id int; v_count int;
begin
    v_uid := _current_user_id(p_session_token);
    select u2.role into v_role from users u2 where u2.user_id = v_uid;
    select gm.goal_id, g.user_id into v_goal_id, v_owner
        from goal_metrics gm join goals g on g.goal_id = gm.goal_id where gm.metric_id = p_metric_id;
    if not _can_manage(v_uid, v_role, v_owner) then raise exception 'FORBIDDEN'; end if;

    select count(*) into v_count from goal_metrics where goal_id = v_goal_id;
    if v_count <= 1 then raise exception 'MUST_KEEP_AT_LEAST_ONE_METRIC'; end if;

    delete from goal_metrics where metric_id = p_metric_id;
    return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7.3 upsert_tactic — เพิ่ม p_frequency (ความถี่การรายงาน)
-- ⚠️ เพิ่มพารามิเตอร์ใหม่ = คนละ signature กับเดิม ต้อง DROP ตัวเก่าก่อน
-- ---------------------------------------------------------------------------
drop function if exists upsert_tactic(uuid, int, int, text, text);
create or replace function upsert_tactic(
    p_session_token uuid, p_tactic_id int, p_goal_id int,
    p_tactic_title text, p_action_plan_description text, p_frequency tactic_frequency default 'WEEKLY'
)
returns int
language plpgsql
security definer
as $$
declare
    v_uid int; v_role user_role; v_owner int; v_id int;
begin
    v_uid := _current_user_id(p_session_token);
    select u2.role into v_role from users u2 where u2.user_id = v_uid;
    select user_id into v_owner from goals where goal_id = p_goal_id;
    if not _can_manage(v_uid, v_role, v_owner) then raise exception 'FORBIDDEN'; end if;

    if p_tactic_id is null then
        insert into tactics (goal_id, tactic_title, action_plan_description, frequency)
        values (p_goal_id, p_tactic_title, p_action_plan_description, coalesce(p_frequency, 'WEEKLY'))
        returning tactic_id into v_id;
    else
        update tactics set tactic_title = p_tactic_title, action_plan_description = p_action_plan_description,
            frequency = coalesce(p_frequency, frequency)
        where tactic_id = p_tactic_id returning tactic_id into v_id;
    end if;
    return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- B.2 รายงาน ทำ/ไม่ทำ ทีเด็ดตามงวด + ดูประวัติย้อนหลัง
-- ---------------------------------------------------------------------------
create or replace function checkin_tactic(
    p_session_token uuid, p_tactic_id int, p_period_date date, p_done boolean, p_notes text default null
)
returns int
language plpgsql
security definer
as $$
declare
    v_uid int; v_role user_role; v_owner int; v_id int;
begin
    v_uid := _current_user_id(p_session_token);
    select u2.role into v_role from users u2 where u2.user_id = v_uid;
    select g.user_id into v_owner from tactics t join goals g on g.goal_id = t.goal_id where t.tactic_id = p_tactic_id;
    if not _can_manage(v_uid, v_role, v_owner) then raise exception 'FORBIDDEN'; end if;

    insert into tactic_checkins (tactic_id, period_date, done, notes, checked_by)
    values (p_tactic_id, p_period_date, p_done, p_notes, v_uid)
    on conflict (tactic_id, period_date) do update set
        done = excluded.done, notes = excluded.notes, checked_by = excluded.checked_by, checked_at = now()
    returning checkin_id into v_id;
    return v_id;
end;
$$;

create or replace function list_tactic_checkins(
    p_session_token uuid, p_tactic_id int, p_from_date date, p_to_date date
)
returns table (period_date date, done boolean, notes text)
language plpgsql
security definer
as $$
declare
    v_uid int; v_role user_role; v_owner int;
begin
    v_uid := _current_user_id(p_session_token);
    select u2.role into v_role from users u2 where u2.user_id = v_uid;
    select g.user_id into v_owner from tactics t join goals g on g.goal_id = t.goal_id where t.tactic_id = p_tactic_id;
    if not _can_manage(v_uid, v_role, v_owner) then raise exception 'FORBIDDEN'; end if;

    return query
    select c.period_date, c.done, c.notes from tactic_checkins c
    where c.tactic_id = p_tactic_id and c.period_date between p_from_date and p_to_date
    order by c.period_date;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8.1 upsert_scoreboard — บันทึกผลจริงรายตัววัด (ไม่ใช่รายเป้าหมายเหมือนเดิม)
-- ⚠️ เปลี่ยนชื่อพารามิเตอร์ (p_goal_id -> p_metric_id) แม้ชนิดข้อมูลจะเหมือนเดิม
-- ทุกตัว Postgres ก็ยังไม่ยอมให้ CREATE OR REPLACE เปลี่ยนชื่อพารามิเตอร์ได้
-- ต้อง DROP ก่อนเสมอ (กฎเดียวกับตอนเปลี่ยน return type)
-- ---------------------------------------------------------------------------
drop function if exists upsert_scoreboard(uuid, int, int, decimal);
create or replace function upsert_scoreboard(
    p_session_token uuid, p_metric_id int, p_month_num int, p_actual_val decimal
)
returns int
language plpgsql
security definer
as $$
declare
    v_uid int; v_role user_role; v_owner int; v_id int;
begin
    v_uid := _current_user_id(p_session_token);
    select u2.role into v_role from users u2 where u2.user_id = v_uid;
    select g.user_id into v_owner from goal_metrics gm join goals g on g.goal_id = gm.goal_id where gm.metric_id = p_metric_id;
    if not _can_manage(v_uid, v_role, v_owner) then raise exception 'FORBIDDEN'; end if;

    insert into scoreboard_monthly (metric_id, month_num, actual_val)
    values (p_metric_id, p_month_num, p_actual_val)
    on conflict (metric_id, month_num) do update set
        actual_val = excluded.actual_val,
        approval_status = case when scoreboard_monthly.approval_status = 'REJECTED' then 'DRAFT' else scoreboard_monthly.approval_status end,
        updated_at = now()
    returning scoreboard_id into v_id;

    return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8.2 get_scoreboard — คืนค่า 1 แถวต่อ (เป้าหมาย, ตัววัด, เดือน) พร้อมค่า
-- "ภาพรวมของทั้งเป้าหมาย" (overall_*) ที่คำนวณจากตัววัดที่แย่ที่สุด แนบซ้ำในทุก
-- แถวของเป้าหมาย+เดือนนั้น ให้ฝั่งเว็บ group by goal_id แล้วหยิบค่า overall
-- จากแถวไหนก็ได้ในกลุ่มเดียวกัน (ค่าเท่ากันหมด)
-- ⚠️ คอลัมน์ผลลัพธ์เปลี่ยนไปจากเดิมมาก ต้อง DROP ก่อน CREATE OR REPLACE เสมอ
-- ---------------------------------------------------------------------------
drop function if exists get_scoreboard(uuid, int, int);
create or replace function get_scoreboard(p_session_token uuid, p_target_user_id int, p_year int)
returns table (
    goal_id int, goal_title text, weight_percentage decimal,
    metric_id int, metric_unit varchar, evaluation_operator eval_operator,
    month_num int, target_val decimal, actual_val decimal,
    variance_val decimal, achievement_percentage decimal, status_color status_color,
    overall_achievement_percentage decimal, overall_status_color status_color,
    approval_status approval_status, reviewer_comments text
)
language plpgsql
security definer
as $$
declare
    v_uid int; v_role user_role;
begin
    v_uid := _current_user_id(p_session_token);
    select u2.role into v_role from users u2 where u2.user_id = v_uid;
    if not _can_manage(v_uid, v_role, p_target_user_id) then raise exception 'FORBIDDEN'; end if;

    return query
    select g.goal_id, g.goal_title, g.weight_percentage,
           gm.metric_id, gm.metric_unit, gm.evaluation_operator, mn.month_num,
           gm.target_value as target_val,
           s.actual_val,
           case when s.actual_val is null then null else s.actual_val - gm.target_value end as variance_val,
           _calc_achievement_pct(gm.target_value, s.actual_val, gm.evaluation_operator) as achievement_percentage,
           _calc_status_color(gm.target_value, s.actual_val, gm.evaluation_operator) as status_color,
           _goal_overall_achievement(g.goal_id, mn.month_num) as overall_achievement_percentage,
           _goal_overall_status(g.goal_id, mn.month_num) as overall_status_color,
           coalesce(s.approval_status, 'DRAFT') as approval_status,
           s.reviewer_comments
    from goals g
    join goal_metrics gm on gm.goal_id = g.goal_id
    cross join generate_series(1,12) as mn(month_num)
    left join scoreboard_monthly s on s.metric_id = gm.metric_id and s.month_num = mn.month_num
    where g.year = p_year and g.is_active = true
      and (g.user_id = p_target_user_id
           or exists (select 1 from goal_co_owners co where co.goal_id = g.goal_id and co.holder_user_id = p_target_user_id))
    order by g.goal_id, gm.sort_order, gm.metric_id, mn.month_num;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8.3-8.5 Approval workflow — เปลี่ยน join จาก goal_id ตรงๆ เป็นผ่าน goal_metrics
-- (การอนุมัติยังทำ "ทั้งเดือน ทุกตัววัด" เหมือนเดิม แค่จำนวนแถวที่ถูกอัปเดตต่อ
-- เดือนจะเพิ่มขึ้นตามจำนวนตัววัดของแต่ละเป้าหมาย)
-- ---------------------------------------------------------------------------
create or replace function submit_monthly_report(p_session_token uuid, p_year int, p_month_num int)
returns int
language plpgsql
security definer
as $$
declare
    v_uid int; v_count int;
begin
    v_uid := _current_user_id(p_session_token);
    update scoreboard_monthly s set approval_status = 'SUBMITTED', reviewer_comments = null
    from goal_metrics gm join goals g on g.goal_id = gm.goal_id
    where gm.metric_id = s.metric_id and g.user_id = v_uid and g.year = p_year
      and s.month_num = p_month_num and s.approval_status in ('DRAFT','REJECTED');
    get diagnostics v_count = row_count;
    return v_count;
end;
$$;

create or replace function get_pending_approvals(p_session_token uuid)
returns table (
    target_user_id int, employee_name text, month_num int, year int, submitted_goals int
)
language plpgsql
security definer
as $$
declare
    v_uid int;
begin
    v_uid := _current_user_id(p_session_token);
    return query
    select g.user_id, (u.first_name || ' ' || u.last_name), s.month_num, g.year,
           count(distinct g.goal_id)::int
    from scoreboard_monthly s
    join goal_metrics gm on gm.metric_id = s.metric_id
    join goals g on g.goal_id = gm.goal_id
    join users u on u.user_id = g.user_id
    where s.approval_status = 'SUBMITTED'
      and _get_approver(g.user_id) = v_uid
    group by g.user_id, u.first_name, u.last_name, s.month_num, g.year;
end;
$$;

create or replace function review_monthly_report(
    p_session_token uuid, p_target_user_id int, p_year int, p_month_num int,
    p_decision approval_status, p_comments text
)
returns int
language plpgsql
security definer
as $$
declare
    v_uid int; v_role user_role; v_count int;
begin
    v_uid := _current_user_id(p_session_token);
    select u2.role into v_role from users u2 where u2.user_id = v_uid;

    if v_role <> 'ADMIN' and _get_approver(p_target_user_id) <> v_uid then
        raise exception 'FORBIDDEN';
    end if;
    if p_decision not in ('APPROVED','REJECTED') then
        raise exception 'INVALID_DECISION';
    end if;

    update scoreboard_monthly s set
        approval_status = p_decision, reviewer_comments = p_comments,
        reviewed_by = v_uid, updated_at = now()
    from goal_metrics gm join goals g on g.goal_id = gm.goal_id
    where gm.metric_id = s.metric_id and g.user_id = p_target_user_id and g.year = p_year
      and s.month_num = p_month_num and s.approval_status = 'SUBMITTED';
    get diagnostics v_count = row_count;
    return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. get_individual_analytics — ใช้ค่า "ภาพรวมของเป้าหมาย" (ตัววัดแย่สุด) แทน
-- การอ่าน g.target_value/g.evaluation_operator ตรงๆ ที่ไม่มีอยู่แล้ว
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
                       round(sum(g.weight_percentage),2) as weighted_target,
                       round(sum(coalesce(_goal_overall_achievement(g.goal_id, mn.month_num),0) * g.weight_percentage/100),2) as weighted_actual
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
