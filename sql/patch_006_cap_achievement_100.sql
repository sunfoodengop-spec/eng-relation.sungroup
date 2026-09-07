-- =============================================================================
-- patch_006_cap_achievement_100.sql
-- คะแนน % สำเร็จ ห้ามเกิน 100 แม้ผลจริงจะดีกว่าเป้าหมายแค่ไหนก็ตาม (สูงสุด = 100)
-- แก้ที่ฟังก์ชันกลาง _calc_achievement_pct จุดเดียว มีผลทุกที่ที่ใช้ค่านี้
-- (get_scoreboard, get_individual_analytics, _goal_overall_achievement ฯลฯ)
--
-- พารามิเตอร์/ชนิดคืนค่าเหมือนเดิมทุกประการ ใช้ CREATE OR REPLACE ตรงๆ ได้เลย
-- ไม่ต้อง DROP ก่อน (ไม่ชนกฎ "ห้ามเปลี่ยนชื่อ/ชนิดพารามิเตอร์หรือ return type")
-- =============================================================================
create or replace function _calc_achievement_pct(p_target decimal, p_actual decimal, p_op eval_operator)
returns decimal
language plpgsql
immutable
as $$
begin
    if p_actual is null then return null; end if;
    if p_op in ('GT','GTE') then
        if coalesce(p_target,0) = 0 then
            return case when p_actual = 0 then 100 else null end;
        end if;
        return least(100, round((p_actual / p_target) * 100, 2));
    elsif p_op in ('LT','LTE') then
        if coalesce(p_target,0) = 0 then
            return case when p_actual = 0 then 100 else 0 end;
        end if;
        return least(100, round((p_target / greatest(p_actual, 0.0001)) * 100, 2));
    elsif p_op = 'EQ' then
        if coalesce(p_target,0) = 0 then
            return case when p_actual = 0 then 100 else 0 end;
        end if;
        return least(100, greatest(0, round(100 - (abs(p_actual - p_target) / p_target) * 100, 2)));
    end if;
    return null;
end;
$$;
