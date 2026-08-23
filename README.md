# ระบบบริหารเป้าหมาย ทีเด็ด และ Scoreboard

Static Web App (HTML/CSS/JS ล้วน ไม่มี build step) + Supabase (Postgres) เป็น
Backend/Database — Deploy ผ่าน GitHub Pages ได้ฟรี

---

## 1. ตั้งค่า Supabase (ทำครั้งเดียว)

1. สร้างโปรเจกต์ใหม่ที่ https://supabase.com
2. เปิด **SQL Editor** → วางเนื้อหาทั้งหมดจาก `sql/schema.sql` → กด **Run**
   - สร้างตาราง, ปิด RLS แบบ deny-all บนทุกตาราง, สร้าง RPC Function ทั้งหมด,
     และใส่ข้อมูลตัวอย่าง (ลบ/แก้ไขได้ทีหลังผ่านหน้า "จัดการพนักงาน")
3. ถ้ามีไฟล์ `sql/seed_org.sql` (สร้างจาก Org Chart จริง) ให้รันต่อจาก
   schema.sql อีกที
4. Project Settings → API → คัดลอก `Project URL` และ `anon public` key มาใส่ใน
   `js/config.js`

> **ทำไมปลอดภัยแม้ฝัง anon key ไว้ใน client:** ทุกตารางเปิด Row Level Security
> แต่ไม่มี policy ให้ role `anon`/`authenticated` เลย จึง query ตรงไม่ได้ทั้งสิ้น
> การเข้าถึงข้อมูลทุกอย่างต้องผ่าน RPC Function ที่เป็น `SECURITY DEFINER`
> เท่านั้น ซึ่งแต่ละฟังก์ชันตรวจสอบ session token + สิทธิ์เองก่อนทำงานทุกครั้ง

## 2. รันทดสอบในเครื่อง

```bash
npx serve .
```

เปิด `http://localhost:3000/login.html`

## 3. Deploy ขึ้น GitHub Pages

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<username>/<repo>.git
git push -u origin main
```

จากนั้น: repo → **Settings → Pages** → Source: `Deploy from a branch` →
Branch: `main`, Folder: `/ (root)` → Save. เว็บจะพร้อมใช้งานที่
`https://<username>.github.io/<repo>/login.html`

## 4. โมดูลที่มีให้

| Module | ไฟล์หลัก |
|---|---|
| Auth + บังคับเปลี่ยนรหัสผ่านครั้งแรก | login.html, js/login.js |
| Dashboard ภาพรวม | js/pages/dashboard.js |
| เป้าหมาย & ทีเด็ด + ถือเป้าร่วม | js/pages/goals.js |
| Scoreboard รายเดือน | js/pages/scoreboard.js |
| อนุมัติรายงาน | js/pages/approvals.js |
| วิเคราะห์ผลงาน (กราฟ) | js/pages/analytics.js |
| ผังองค์กร (Tree + เส้นเชื่อม) | js/pages/org.js |
| จัดการพนักงาน (Admin) | js/pages/adminUsers.js |
| ส่งออก Excel | js/pages/exportPage.js |

## 5. บัญชีทดสอบเริ่มต้น (จาก demo seed ใน schema.sql)

| รหัสพนักงาน | รหัสผ่าน | สิทธิ์ |
|---|---|---|
| 900001 | 900001 | ADMIN |
| 443757 | 443757 | SUPERVISOR |
| 591144 | 591144 | STAFF |

ทุกบัญชีบังคับตั้งรหัสผ่านใหม่ตอนล็อกอินครั้งแรก — เปลี่ยนรหัสผ่านของ ADMIN
ทันทีหลัง deploy จริง
