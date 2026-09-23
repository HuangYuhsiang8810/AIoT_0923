# CWA 台灣天氣圖台 — Vercel Edition

以 Next.js App Router 建置的中央氣象署 36 小時天氣預報圖台，可直接部署至 Vercel。後端使用 Route Handlers 串接 CWA API，正式環境使用 Neon Serverless Postgres 保存資料。

## 架構

```text
Next.js 16.3 App Router
├─ app/page.tsx                 Server Component 首屏資料
├─ components/WeatherConsole   React／Leaflet／tsParticles 圖台
├─ app/api/weather             天氣資料 API
├─ app/api/status              儲存與同步狀態
├─ app/api/sync                手動整理資料
├─ app/api/cron                Vercel Cron 同步入口
├─ lib/cwa.ts                  CWA API 正規化
└─ lib/weather-store.ts        Neon／本機記憶體資料層
```

正式部署使用 Neon Postgres；未設定 `DATABASE_URL` 時會自動使用程序記憶體，方便本機開發，但重啟後資料會消失。

## 本機開發

需要 Node.js 20.9 或更新版本。

```powershell
npm install
Copy-Item .env.local.example .env.local
npm run dev
```

編輯 `.env.local`：

```dotenv
CWA_API_KEY=你的中央氣象署授權碼
CWA_DATASET_ID=F-C0032-001
DATABASE_URL=你的 Neon Postgres 連線字串
CRON_SECRET=至少16字元的隨機字串
```

若只進行本機畫面開發，可以暫時省略 `DATABASE_URL` 與 `CRON_SECRET`。

網站預設位於 <http://localhost:3000>。

## 部署至 Vercel

1. 將專案推送至 GitHub、GitLab 或 Bitbucket。
2. 在 Vercel 匯入專案；Framework Preset 會自動辨識為 Next.js。
3. 從 Vercel Marketplace 安裝 Neon，並連接至這個專案。Vercel 會自動注入 `DATABASE_URL`。
4. 在 Project Settings → Environment Variables 加入：
   - `CWA_API_KEY`
   - `CWA_DATASET_ID=F-C0032-001`
   - `CRON_SECRET`（至少 16 字元）
5. 重新部署。

資料表會在第一次請求時自動建立，不需要手動執行 migration。`vercel.json` 設定每日 UTC 00:05 執行同步；資料超過三小時且有人讀取網站時，也會自動向 CWA 更新，因此 Hobby 方案仍可保持資料新鮮。

> 正式部署前請重新產生 CWA API Key。授權碼只能放在 Vercel 環境變數中，不可提交至 Git。

## 指令

```powershell
npm run dev      # 開發伺服器
npm run lint     # ESLint
npm run build    # Vercel production build
npm run start    # 啟動 production build
```

## API

- `GET /api/weather`：22 縣市整理後的預報
- `GET /api/status`：資料庫與最近同步狀態
- `POST /api/sync`：同步資料；五分鐘內重複呼叫會直接使用現有資料
- `GET /api/cron`：Vercel Cron 專用，需 `Authorization: Bearer <CRON_SECRET>`

## 驗證狀態

- Next.js production build：通過
- TypeScript：通過
- ESLint：通過
- CWA API：22 縣市、3 時段、330 筆資料
- Production browser render：通過
