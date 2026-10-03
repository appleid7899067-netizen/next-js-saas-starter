# Next.js SaaS Starter

This is a starter template for building a SaaS application using **Next.js** with support for authentication, Stripe integration for payments, and a dashboard for logged-in users.

**Demo: [https://next-saas-start.vercel.app/](https://next-saas-start.vercel.app/)**

## Features

- Marketing landing page (`/`) with animated Terminal element
- Pricing page (`/pricing`) which connects to Stripe Checkout
- Dashboard pages with CRUD operations on users/teams
- Basic RBAC with Owner and Member roles
- Subscription management with Stripe Customer Portal
- Email/password authentication with JWTs stored to cookies
- **Puter Console** (`/puter`): Puter login for 500+ AI models (User-Pays, no API keys), a per-user command sandbox and a live-streaming terminal
- Global middleware to protect logged-in routes
- Local middleware to protect Server Actions or validate Zod schemas
- Activity logging system for any user events

## Puter Console (โมเดล AI + แซนบ็อก + เทอร์มินอลสตรีม)

The dashboard ships with a **Puter Console** at [`/puter`](app/(dashboard)/puter/page.tsx) that
combines three things:

| ส่วน | ทำอะไร | ใช้ API อะไร |
| --- | --- | --- |
| **ล็อกอินโมเดล** | ล็อกอินด้วยบัญชี Puter (ป๊อปอัป) แล้วเลือกโมเดลจาก 500+ ตัว และแชทแบบสตรีมทีละ chunk | `puter.auth.*`, `puter.ai.listModels()`, `puter.ai.chat(..., { stream: true })` |
| **แซนบ็อก** | เชลล์จริงต่อผู้ใช้ 1 เซสชัน ในเวิร์กสเปซแยก (`bash` บน PTY) + เปิด/อ่าน/เขียน/ลบไฟล์ผ่าน UI | `lib/sandbox/session.ts` + `/api/sandbox/*` |
| **เทอร์มินอลสตรีม** | เอาต์พุตสตรีมกลับมาที่เบราว์เซอร์แบบเรียลไทม์ (SSE, มี polling fallback) พร้อม ANSI colour | `GET /api/sandbox/stream` |

จุดสำคัญ:

- **ไม่ต้องใช้ API key ของค่ายโมเดลเลย** — ใช้โมเดล User-Pays ของ Puter
  (ค่าใช้งานคิดกับบัญชี Puter ของผู้ใช้ ไม่ใช่เจ้าของแอป)
- ตัวตน Puter ถูกเก็บเป็น **คุกกี้ที่เซ็นด้วย `AUTH_SECRET`** (`puter_session`, httpOnly)
  ผ่าน `POST /api/puter/session` — ฝั่งเซิร์ฟเวอร์ไม่เคยเห็นรหัสผ่าน
- ปุ่ม **Run ในแซนบ็อก** ในบล็อกโค้ดของคำตอบ AI จะส่งคำสั่งไปที่เทอร์มินอลจริง
  และ **Save to Puter** จะเขียนบทสนทนา (และ log ของเทอร์มินอล) ลง Puter Drive
  ในโฟลเดอร์ AppData ของแอป (`puter.fs.write` → Puter-side sandbox ต่อแอป)
- เทอร์มินอลใช้เวลาว่างเกิน 30 นาทีจะถูกปิดอัตโนมัติ (สูงสุด 12 เซสชันต่อโปรเซส)

ตัวแปรสภาพแวดล้อมที่เกี่ยวข้อง (ทั้งหมดมีค่าเริ่มต้น):

```bash
SANDBOX_ROOT=.sandbox        # ที่เก็บเวิร์กสเปซของเทอร์มินอลแซนบ็อก
SANDBOX_DISABLED=0           # ตั้งเป็น 1 เพื่อปิดฟีเจอร์เทอร์มินอลทั้งหน้า
```

> ⚠️ เทอร์มินอลนี้รันคำสั่งบนคอนเทนเนอร์เดียวกับแอป (เดโม ไม่ได้ทำ hardening แบบ production)
> เหมาะกับการทดลอง — อย่าเปิดให้ผู้ใช้ไม่รู้จักในโปรดักชันโดยไม่เพิ่ม sandboxing จริงจัง

## Tech Stack

- **Framework**: [Next.js](https://nextjs.org/)
- **Database**: [Postgres](https://www.postgresql.org/)
- **ORM**: [Drizzle](https://orm.drizzle.team/)
- **Payments**: [Stripe](https://stripe.com/)
- **UI Library**: [shadcn/ui](https://ui.shadcn.com/)

## Getting Started

```bash
git clone https://github.com/nextjs/saas-starter
cd saas-starter
pnpm install
```

## Running Locally

[Install](https://docs.stripe.com/stripe-cli) and log in to your Stripe account:

```bash
stripe login
```

Use the included setup script to create your `.env` file (optional — see below):

```bash
pnpm db:setup
```

Run the database migrations and seed the database with a default user and team:

```bash
pnpm db:migrate
pnpm db:seed
```

### Running without Postgres / Stripe (zero-config mode)

ถ้ายังไม่มี `POSTGRES_URL` แอปจะสตาร์ทด้วย **embedded Postgres (PGlite)** ที่เก็บในโฟลเดอร์
`.pglite/` ให้อัตโนมัติ: รัน migration เองและสร้างบัญชีเดโมให้เลย

- User: `test@test.com`
- Password: `admin123`

ถ้าไม่มี `STRIPE_SECRET_KEY` หน้า `/pricing` จะแสดงแผนตัวอย่างและปุ่มเช็กเอาต์จะแจ้งว่ายังไม่ได้ตั้งค่า Stripe
และถ้าไม่มี `AUTH_SECRET` ระบบจะใช้คีย์สำหรับดีเวลอปเมนต์พร้อมคำเตือน (อย่าใช้ค่านี้ในโปรดักชัน)

This will create the following user and team:

- User: `test@test.com`
- Password: `admin123`

You can also create new users through the `/sign-up` route.

Finally, run the Next.js development server:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to see the app in action.

You can listen for Stripe webhooks locally through their CLI to handle subscription change events:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

## Testing Payments

To test Stripe payments, use the following test card details:

- Card Number: `4242 4242 4242 4242`
- Expiration: Any future date
- CVC: Any 3-digit number

## Going to Production

When you're ready to deploy your SaaS application to production, follow these steps:

### Set up a production Stripe webhook

1. Go to the Stripe Dashboard and create a new webhook for your production environment.
2. Set the endpoint URL to your production API route (e.g., `https://yourdomain.com/api/stripe/webhook`).
3. Select the events you want to listen for (e.g., `checkout.session.completed`, `customer.subscription.updated`).

### Deploy to Vercel

1. Push your code to a GitHub repository.
2. Connect your repository to [Vercel](https://vercel.com/) and deploy it.
3. Follow the Vercel deployment process, which will guide you through setting up your project.

### Deploy to Render

[`render.yaml`](render.yaml) เป็น Blueprint พร้อมใช้ (web service + managed Postgres):

1. Push โค้ดขึ้น GitHub แล้วใน Render เลือก **New → Blueprint** → เลือก repository นี้ → **Apply**
   (ถ้าต้องการ deploy จาก branch ที่กำลังทำอยู่ ให้เลือก branch นั้นตอนสร้าง service)
2. Render build ด้วย `pnpm install --frozen-lockfile && pnpm build:standalone`
   แล้ว start ด้วย `node .next/standalone/server.js`
   (`scripts/prepare-standalone.mjs` จะคัดลอก migration ไปไว้ข้าง `server.js` ให้เอง)
3. ตั้ง `BASE_URL` เป็น `https://<service>.onrender.com` (ใช้กับ redirect ของ Stripe)
4. เข้าใช้งานครั้งแรก: สมัครที่ `/sign-up` — หรือตั้ง `SEED_DEMO_ACCOUNT=1`
   เพื่อให้สร้างบัญชี `test@test.com` / `admin123` ให้อัตโนมัติตอนบูต

ทำแบบ manual (ไม่ใช้ Blueprint) ก็ได้: สร้าง **Web Service** แล้วตั้งค่า

| Setting | Value |
| --- | --- |
| Build Command | `pnpm install --frozen-lockfile && pnpm build:standalone` |
| Start Command | `node .next/standalone/server.js` |
| Health Check Path | `/` |
| Env vars | `POSTGRES_URL`, `AUTH_SECRET`, `BASE_URL` (+ `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` ถ้าใช้ Stripe) |

หมายเหตุสำหรับการ deploy:

- **Migration รันอัตโนมัติตอนบูต** (`lib/db/drizzle.ts` + `lib/db/migrate.ts`) จึงไม่ต้องสั่ง
  `pnpm db:migrate` เอง — ถ้าหาโฟลเดอร์ migration ไม่เจอ ระบบจะข้ามและ log คำเตือนไว้
  (ค้นหาจาก `MIGRATIONS_DIR`, `lib/db/migrations` ของโปรเจกต์ และข้าง `server.js`)
- ถ้าไม่ตั้ง `POSTGRES_URL` แอปจะใช้ embedded PGlite (`.pglite/`) — ข้อมูลจะหายเมื่อ redeploy
  บนแพลตฟอร์มที่ดิสก์เป็น ephemeral ดังนั้นบน Render ให้ใช้ managed Postgres และใช้
  connection string แบบ **internal** (ไม่ต้องใช้ SSL); ถ้าใช้ external URL ให้เติม `?sslmode=require`
- ตั้ง **`SANDBOX_DISABLED=1`** ถ้าไม่ต้องการให้ผู้ใช้รันคำสั่งเชลล์บนเซิร์ฟเวอร์ที่ deploy จริง
  เพราะเทอร์มินอลแซนบ็อกรันอยู่บนคอนเทนเนอร์เดียวกับเว็บแอป
- Vercel/ที่อื่นยังใช้ได้เหมือนเดิมด้วย `pnpm build` + `pnpm start` (ไม่ต้องใช้ standalone)

### Add environment variables

In your Vercel project settings (or during deployment), add all the necessary environment variables. Make sure to update the values for the production environment, including:

1. `BASE_URL`: Set this to your production domain.
2. `STRIPE_SECRET_KEY`: Use your Stripe secret key for the production environment.
3. `STRIPE_WEBHOOK_SECRET`: Use the webhook secret from the production webhook you created in step 1.
4. `POSTGRES_URL`: Set this to your production database URL.
5. `AUTH_SECRET`: Set this to a random string. `openssl rand -base64 32` will generate one.

## Other Templates

While this template is intentionally minimal and to be used as a learning resource, there are other paid versions in the community which are more full-featured:

- https://achromatic.dev
- https://shipfa.st
- https://makerkit.dev
- https://zerotoshipped.com
- https://turbostarter.dev
