-- =============================================================================
-- seed_org.sql — ผังองค์กรแผนกวิศวกรรม (ENG) — Goal & Scoreboard System
-- อิงจากไฟล์ Relation_ENG_2026 + การยืนยันแก้ไขผังในบทสนทนา
--
-- org_level scheme (ยืนยันโดยผู้ใช้):
--   80 = ผจก.ทั่วไป            (ADMIN)
--   75 = ผจก.ฝ่าย / ผู้เชี่ยวชาญพิเศษ   (SUPERVISOR)
--   65 = ผจก.ส่วน / ผู้เชี่ยวชาญ        (SUPERVISOR ถ้ามีลูกทีม, STAFF ถ้าเป็นผู้เชี่ยวชาญ)
--   55 = ผจก.แผนก / ผู้ชำนาญการพิเศษ    (SUPERVISOR)
--   40 = วิศวกร / ผู้ชำนาญการ            (STAFF)
--
-- คนที่ยังไม่มีรหัสพนักงานจริง ใช้รหัสชั่วคราว NC0001-NC0006 (ตามที่ยืนยันไว้)
-- ผู้จัดการทั่วไปเป็นคนเดียวที่ตั้ง role = ADMIN, ที่เหลือ SUPERVISOR ตามตำแหน่ง
-- "ผจก./หัวหน้าแผนก" (มีลูกทีมตามผัง หรือมีศักยภาพรับลูกทีมในอนาคต), นอกนั้น STAFF
-- =============================================================================

create temporary table org_staging (
    emp_code             varchar(50) primary key,
    supervisor_emp_code  varchar(50),
    first_name           varchar(100),
    last_name             varchar(100),
    nickname              varchar(50),
    position_title        varchar(150),
    department             varchar(100),
    org_level             smallint,
    role                  user_role
);

insert into org_staging
    (emp_code, supervisor_emp_code, first_name, last_name, nickname, position_title, department, org_level, role)
values
    -- ผู้จัดการทั่วไป (บนสุด, ไม่มีแผนก)
    ('540460', null,     'พงศ์พันธ์', 'แซ่โล่',          'เกียร์', 'ผู้จัดการทั่วไป',                  null,      80, 'ADMIN'),

    -- สาย LMN2
    ('601184', '540460', 'พิทยุตม์',  'ทรัพย์สมบูรณ์',    'ภูมิ',   'ผู้จัดการฝ่าย LMN2',                'LMN2',    75, 'SUPERVISOR'),
    ('600932', '601184', 'ประเสริฐ',  'คุณารักษ์',         'เสริฐ',  'ผู้จัดการแผนก LMN2',               'LMN2',    55, 'SUPERVISOR'),
    ('620311', '601184', 'คงฤทธิ์',   'จันทะสิงห์',        'แบงค์',  'ผู้จัดการแผนก LMN2',               'LMN2',    55, 'SUPERVISOR'),
    ('680415', '620311', 'ศุภณัฐ',    'พฤกษชาติ',          'บูม',    'เจ้าหน้าที่ LMN2',                  'LMN2',    40, 'STAFF'),
    ('NC0001', '620311', 'นิพิฐพนธ์', 'หิริ',              'ฟอร์ด',  'เจ้าหน้าที่ LMN2',                  'LMN2',    40, 'STAFF'),
    ('491338', '601184', 'สัญญา',     'ไก่ฟ้า',            'กบ',     'ผู้เชี่ยวชาญ',                      'LMN2',    65, 'STAFF'),

    -- สาย RD
    ('630122', '540460', 'ณัฐพล',     'จุลพันธ์',          'นัฐ',    'รักษาการผู้จัดการฝ่าย RD',           'RD',      75, 'SUPERVISOR'),
    ('670300', '630122', 'คณิน',      'สิริจำรัสวงศ์',      'แม็ก',   'เจ้าหน้าที่วิศวกรรม RD',            'RD',      40, 'STAFF'),

    -- สาย OPRF / ENF / SRN (วิศวกรรม) — อัษฎาวุธ คุม 3 สาย: OP, SRN, ENF (แสดงเป็น Block เดียวคร่อมกลาง 3 คอลัมน์)
    ('620304', '540460', 'อัษฎาวุธ',  'ชำนาญพล',          'หนึ่ง',  'รักษาการผู้จัดการฝ่าย OPRF/ENF/SRN', 'OP,SRN,ENF', 75, 'SUPERVISOR'),
    ('620303', '620304', 'นิธิพงศ์',  'สิงห์ทอง',          'เพียว',  'ผู้จัดการส่วน OP/SRN',              'OP,SRN',  65, 'SUPERVISOR'),
    ('670151', '620303', 'ภานุ',      'บุญรอด',            'ปั่น',   'เจ้าหน้าที่ OP',                    'OP',      40, 'STAFF'),
    ('680194', '620303', 'วรวุฒิ',    'ชื่นจิต',            'กอล์ฟ',  'เจ้าหน้าที่ OP',                    'OP',      40, 'STAFF'),
    ('680195', '620303', 'วีรภาพ',    'ราชเจริญ',          'ก้อง',   'เจ้าหน้าที่ SRN',                   'SRN',     40, 'STAFF'),
    ('NC0002', '620303', 'ปริญญา',    'นิลคช',             'ไบรท์',  'เจ้าหน้าที่ SRN',                   'SRN',     40, 'STAFF'),
    ('NC0003', '620304', 'ณภัสรพี',   '',                  null,     'ผู้จัดการแผนก ENF',                 'ENF',     55, 'SUPERVISOR'),
    ('470526', '620304', 'ทัศน์',     'จารัตน์',            'จ่า',    'ผู้เชี่ยวชาญ ENF',                  'ENF',     65, 'STAFF'),

    -- สาย Prod SRN (แยกออกมาจากวีรภาพ, ตรงจาก GM)
    ('410927', '540460', 'ธัชณพงศ์',  'สิริภัทรจิรกวิน',    'ธานินทร์', 'รักษาการผู้จัดการฝ่าย Prod SRN',  'Prod SRN', 75, 'SUPERVISOR'),

    -- สาย ENE & ASRS — บั๊กโจ้ คุม 2 สาย: พลังงาน, ASRS (แสดงเป็น Block เดียวคร่อมกลาง 2 คอลัมน์ ตามกติกาเดียวกับอัษฎาวุธ/เพียว)
    ('610832', '540460', 'ณัฏฐวัสส์', 'ไตรยงค์',          'บั๊กโจ้', 'รักษาการผู้จัดการฝ่าย ENE&ASRS',    'พลังงาน,ASRS', 75, 'SUPERVISOR'),
    ('NC0004', '610832', 'วิษุวัต',   'ว่องไพกุล',          'จี๊บ',   'หัวหน้าแผนกพลังงาน',                'พลังงาน', 55, 'SUPERVISOR'),
    ('NC0005', 'NC0004', 'ภาณุพงศ์',  'พาประกอบ',          null,     'เจ้าหน้าที่ระบบน้ำ',                'พลังงาน', 40, 'STAFF'),
    ('NC0006', 'NC0004', 'ณัฐพนธ์',   'สิงห์เส',           null,     'เจ้าหน้าที่ไบโอแก๊ส',               'พลังงาน', 40, 'STAFF'),
    ('680180', '610832', 'สิงหา',     'พึ่งประสม',          null,     'หัวหน้าแผนก ASRS',                  'ASRS',    55, 'SUPERVISOR'),
    ('660259', '680180', 'พรพิพัฒน์', 'กรรฐโรจน์',          null,     'เจ้าหน้าที่ ASRS',                  'ASRS',    40, 'STAFF'),

    -- สาย LMN1 (สองผจก.แผนก รายงานตรง GM)
    ('620313', '540460', 'ณัฐณิชา',   'นาคทั่ง',           'มิ้ว',   'ผู้จัดการแผนก LMN 1',               'LMN1',    55, 'SUPERVISOR'),
    ('630120', '540460', 'ชญานี',     'รินทะลึก',          'ปลาย',   'ผู้จัดการแผนก LMN1',                'LMN1',    55, 'SUPERVISOR'),
    ('690470', '630120', 'อาทิตย์',   'เขตบุรี',           'ตะวัน',  'เจ้าหน้าที่แผนก LMN1',              'LMN1',    40, 'STAFF')
;

-- Pass 1: upsert ทุกคน (ยังไม่ผูก supervisor_id)
insert into users (emp_code, password_hash, first_name, last_name, nickname,
    position_title, department, org_level, role)
select emp_code, crypt(emp_code, gen_salt('bf')), first_name, last_name,
    nickname, position_title, department, org_level, role
from org_staging
on conflict (emp_code) do update set
    first_name = excluded.first_name, last_name = excluded.last_name,
    nickname = excluded.nickname, position_title = excluded.position_title,
    department = excluded.department, org_level = excluded.org_level,
    role = excluded.role;

-- Pass 2: ผูก supervisor_id จาก emp_code หลังทุกคนถูกสร้างแล้ว
update users u set supervisor_id = sup.user_id
from org_staging s join users sup on sup.emp_code = s.supervisor_emp_code
where u.emp_code = s.emp_code and s.supervisor_emp_code is not null;

-- Sanity check
select emp_code, first_name, last_name, nickname, position_title, department,
       org_level, role,
       (select first_name || ' ' || last_name from users s where s.user_id = u.supervisor_id) as supervisor_name
from users u where emp_code in (select emp_code from org_staging)
order by org_level desc, department, first_name;
