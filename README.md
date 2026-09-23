# 台灣氣象 GIS 圖台

以中央氣象署（CWA）開放資料為核心，將天氣資料擷取、標準化、儲存後，疊加於公開 GIS 底圖上，並透過 Next.js 與 Vercel 提供互動式網頁服務。

- 正式網站：<https://aiot0923.vercel.app>
- GitHub：<https://github.com/HuangYuhsiang8810/AIoT_0923>
- 主要技術：Next.js 16、React 19、TypeScript、Leaflet、OpenStreetMap、Neon PostgreSQL、Vercel

> 安全提醒：CWA API Key、資料庫連線字串與排程密鑰只能放在 `.env.local` 或 Vercel Environment Variables，不可提交到 GitHub。

## 1. 專案目標

本系統依照以下工作流程設計：

1. 從中央氣象署取得最新氣象資料。
2. 驗證、轉換並儲存 CWA 資料。
3. 將氣象資料疊加至公開 GIS 底圖。
4. 將原始碼與文件版本化到 GitHub。
5. 完成資料、API、畫面與部署驗收。

目前網站主要使用 `F-C0032-001`「今明 36 小時天氣預報」。此資料集由 CWA 每 6 小時更新，因此應稱為「最新預報」，不是逐秒即時觀測。

若需要接近即時的測站觀測值，下一階段可加入 `O-A0003-001`「氣象觀測站－10 分鐘綜觀氣象資料」，將氣溫、雨量、風速、風向、相對溼度等測站資料與縣市預報同時呈現。

## 2. 目前上線狀態

| 項目 | 狀態 | 說明 |
| --- | --- | --- |
| Next.js 網站 | 已上線 | Production URL 為 `aiot0923.vercel.app` |
| CWA 36 小時預報 | 已連線 | 22 縣市、每縣市 3 個時段、5 個預報因子 |
| GIS 底圖 | 已完成 | Leaflet 顯示 OpenStreetMap raster tiles |
| 氣象圖層 | 已完成 | 氣溫、降雨機率、天氣現象、舒適度 |
| 動態天氣效果 | 已完成 | tsParticles 依晴、陰、雨、雷雨切換效果 |
| GitHub | 已連線 | `main` 分支作為正式版本來源 |
| Vercel Production 環境變數 | 部分完成 | `CWA_API_KEY`、`CWA_DATASET_ID` 已設定 |
| Neon PostgreSQL | 待連接 | 未設定 `DATABASE_URL` 時使用記憶體暫存，不適合正式持久化 |
| Vercel Cron | 待啟用 | 必須先設定 `CRON_SECRET`，否則 `/api/cron` 會回傳 401 |
| 公開存取 | 依 Vercel 設定 | 若啟用 Deployment Protection，未登入者會先看到 Vercel 登入頁 |

## 3. 資料來源

### 3.1 CWA 縣市預報（目前已實作）

- 提供單位：中央氣象署
- 資料集：[`F-C0032-001` 一般天氣預報－今明 36 小時天氣預報](https://opendata.cwa.gov.tw/dataset/all/F-C0032-001)
- 更新頻率：每 6 小時
- 涵蓋範圍：臺灣 22 縣市
- API 格式：REST / JSON
- API 端點：

```text
GET https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-C0032-001
    ?Authorization=<CWA_API_KEY>
    &format=JSON
```

主要欄位：

| CWA 欄位 | 中文意義 | 畫面用途 |
| --- | --- | --- |
| `Wx` | 天氣現象 | 天氣圖示、Popup、動態背景 |
| `PoP` | 降雨機率 | 降雨圖層與百分比標籤 |
| `MinT` | 最低溫度 | Popup 與摘要資訊 |
| `MaxT` | 最高溫度 | 氣溫圖層、色階與摘要資訊 |
| `CI` | 舒適度 | 舒適度圖層與 Popup |
| `startTime` | 預報開始時間 | 時段切換與資料版本判定 |
| `endTime` | 預報結束時間 | 時段切換與 Popup |

完整資料量通常為：

```text
22 縣市 × 5 個預報因子 × 3 個預報時段 = 330 筆正規化資料
```

CWA API 需要會員授權碼；取得與呼叫方式請參考[中央氣象署開放資料平臺使用說明](https://opendata.cwa.gov.tw/devManual/insrtuction)。

### 3.2 CWA 測站觀測（建議的即時資料擴充）

- 資料集：[`O-A0003-001` 氣象觀測站－10 分鐘綜觀氣象資料](https://opendata.cwa.gov.tw/dataset/climate/O-A0003-001)
- 更新頻率：每 10 分鐘
- 可用欄位：測站代碼、測站時間、經緯度、氣溫、降水量、風速、風向、相對溼度、氣壓、紫外線等
- 建議用途：網站的「現在觀測」模式、測站點位圖層、縣市最新實測值

建議介面同時保留兩種資料語意：

- `現在觀測`：來自 `O-A0003-001`，顯示測站最近 10 分鐘觀測值。
- `未來預報`：來自 `F-C0032-001`，顯示未來 36 小時縣市預報。

不可用預報資料冒充即時觀測；畫面必須顯示「觀測時間」、「預報起訖時間」及「最後同步時間」。

### 3.3 GIS 公開資料

- 地圖引擎：[Leaflet 1.9.4](https://leafletjs.com/reference)
- 公開底圖：[OpenStreetMap](https://www.openstreetmap.org/copyright)
- Raster tile URL：`https://tile.openstreetmap.org/{z}/{x}/{y}.png`
- 必要標示：`© OpenStreetMap contributors`
- 使用規則：[OpenStreetMap Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/)

目前版本以 OpenStreetMap 作為背景地理資訊，並以 `locationName` 對應 `CITY_COORDS` 中的縣市代表座標，再將 CWA 資料繪製成 Leaflet Marker 與 Popup。

目前的縣市座標是應用程式維護的代表點，不是行政區邊界資料。若要製作正式縣市色塊圖（Choropleth），應再導入政府公開的行政區 GeoJSON，使用縣市代碼或標準化縣市名稱進行 Join，不應以模糊文字比對。

## 4. 系統架構

```mermaid
flowchart LR
    CWA[CWA Open Data API] -->|HTTPS JSON| FETCH[Next.js Data Fetcher]
    FETCH --> VALIDATE[Schema / 欄位 / 時間驗證]
    VALIDATE --> NORMALIZE[正規化 WeatherRow]
    NORMALIZE --> UPSERT[Upsert + 同步紀錄]
    UPSERT --> DB[(Neon PostgreSQL)]

    DB --> API[Next.js Route Handlers]
    API --> UI[React WeatherConsole]
    OSM[OpenStreetMap Tiles] --> MAP[Leaflet GIS Map]
    UI --> MAP
    MAP --> USER[Browser]

    CRON[Vercel Cron] -->|Bearer CRON_SECRET| SYNC[/api/cron]
    SYNC --> FETCH
    USER -->|手動更新| MANUAL[/api/sync]
    MANUAL --> FETCH

    GITHUB[GitHub main] --> VERCEL[Vercel Build & Deploy]
    VERCEL --> API
    VERCEL --> UI
```

### 元件責任

| 層級 | 元件 | 責任 |
| --- | --- | --- |
| 外部資料 | CWA API | 提供官方預報或觀測 JSON |
| 資料擷取 | `lib/cwa.ts` | 組合 API URL、驗證授權、設定 timeout、解析 CWA 回傳 |
| 資料服務 | `lib/weather-store.ts` | 同步、去重、Upsert、過期判定、查詢與 API response 組裝 |
| 資料庫 | Neon PostgreSQL | 保存最新預報快照與同步結果 |
| Backend API | `app/api/*` | 對前端、手動同步與 Vercel Cron 提供介面 |
| SSR 頁面 | `app/page.tsx` | 首次請求於伺服器端載入資料，避免空白首屏 |
| 前端 | `components/WeatherConsole.tsx` | 地圖、圖層、時段、Popup、定位與動態效果 |
| GIS | Leaflet + OSM | 底圖顯示、Marker、Popup 與地圖互動 |
| 部署 | GitHub + Vercel | 版本控制、Preview、Production build 與 Serverless Functions |

## 5. 資料處理流程

```mermaid
sequenceDiagram
    participant Job as Cron / User
    participant API as Next.js API
    participant CWA as CWA Open Data
    participant DB as Neon PostgreSQL
    participant Web as Weather UI

    Job->>API: GET /api/cron 或 POST /api/sync
    API->>CWA: GET dataset + Authorization
    CWA-->>API: JSON 預報資料
    API->>API: 驗證 success、縣市、欄位、時間
    API->>API: 展平成 WeatherRow
    API->>DB: Upsert weather_forecasts
    API->>DB: 寫入 sync_runs
    API-->>Job: recordCount / syncedAt
    Web->>API: GET /api/weather
    API->>DB: 讀取最新 syncedAt 快照
    DB-->>API: 最新 330 筆資料
    API-->>Web: 22 縣市 × 3 時段
    Web->>Web: 疊加到 Leaflet GIS 地圖
```

### 5.1 擷取

`fetchCwaRows()` 執行以下處理：

1. 從伺服器環境變數讀取 `CWA_API_KEY`。
2. 呼叫 CWA REST API，禁止瀏覽器直接持有金鑰。
3. 使用 `cache: no-store` 取得最新回應，請求逾時為 30 秒。
4. 確認 HTTP status 與 CWA `success` 欄位。
5. 解析不同大小寫格式的 CWA 欄位。
6. 展平為資料庫可儲存的 `WeatherRow[]`。
7. 若結果為空，視為同步失敗，不覆蓋既有有效資料。

### 5.2 正規化

每筆 `WeatherRow` 只保存一個縣市、一個因子及一個時段：

```ts
type WeatherRow = {
  datasetId: string;
  locationName: string;
  elementName: string;
  startTime: string;
  endTime: string;
  value: string;
  unit: string | null;
  syncedAt: string;
};
```

這個結構可以穩定支援查詢、Upsert、品質檢查，以及未來新增其他 CWA 資料集。

### 5.3 更新策略

- 資料超過 3 小時：讀取時嘗試向 CWA 重新同步。
- 5 分鐘內重複手動同步：跳過，避免短時間重複請求。
- Vercel Cron：`vercel.json` 設定每日 UTC 00:05（臺灣時間 08:05）執行。
- CWA `F-C0032-001` 每 6 小時更新；若需要更貼近官方更新頻率，應依 Vercel 方案調整 Cron，並保留讀取時更新機制。
- CWA 失敗但 DB 有舊資料：繼續回傳最後一份有效快照，同時保留錯誤狀態。
- CWA 失敗且 DB 無資料：API 回傳錯誤，前端顯示失敗訊息，不顯示偽造資料。

## 6. 資料庫設計

正式環境建議使用 Neon Serverless PostgreSQL。設定 `DATABASE_URL` 後，系統會自動建立資料表與索引。

### 6.1 `weather_forecasts`

保存最新一批預報明細。

| 欄位 | 用途 |
| --- | --- |
| `dataset_id` | CWA 資料集代碼 |
| `location_name` | 縣市名稱 |
| `element_name` | `Wx`、`PoP`、`MinT`、`MaxT`、`CI` |
| `start_time` / `end_time` | 預報有效期間 |
| `value` / `unit` | 資料值與單位 |
| `synced_at` | 本系統完成擷取的時間 |

唯一鍵：

```text
(dataset_id, location_name, element_name, start_time, end_time)
```

相同預報時段使用 `ON CONFLICT ... DO UPDATE`，因此重複執行同步仍具冪等性，不會產生重複資料。

### 6.2 `sync_runs`

保存每次同步工作的稽核紀錄：

- `started_at` / `completed_at`
- `status`：`running`、`success`、`failed`
- `record_count`
- `error_message`

### 6.3 保留策略

目前程式在成功同步後刪除舊版預報，只保留最新快照，適合即時圖台與降低資料量。

若未來需要趨勢分析、模型訓練或歷史稽核，建議新增 `weather_forecast_history`，依 `synced_at` 分區保存歷史版本，並另外制定保存天數與封存政策。

### 6.4 記憶體 fallback 的限制

沒有 `DATABASE_URL` 時，系統會暫存於 Serverless Function 記憶體。此模式只適合本機開發：

- Vercel 冷啟動後資料可能消失。
- 不同 Function instance 之間不保證共用資料。
- `/api/status` 可能和 `/api/weather` 顯示不同 instance 的暫存狀態。

因此 Production 要符合「拉下來並儲存」的需求，必須連接 Neon 或其他持久化 PostgreSQL。

## 7. GIS 疊圖設計

```text
OpenStreetMap raster tiles
        ↓
Leaflet Map
        ↓
縣市代表座標 CITY_COORDS
        ↓
CWA locationName + WeatherPeriod
        ↓
溫度／降雨／天氣／舒適度 Marker + Popup
```

顯示邏輯：

- 氣溫：以最高溫映射藍、綠、黃、橘、紅色階。
- 降雨：以降雨機率映射不同藍紫色階。
- 天氣：依 `Wx` 顯示晴、雲、雨、雷雨圖示。
- 舒適度：依 `CI` 顯示舒適、悶熱等文字。
- Popup：顯示縣市、預報時段、天氣、最低／最高溫、降雨機率與舒適度。
- 動態效果：依選取縣市的 `Wx` 切換晴光、雲霧、雨滴或雷雨粒子。

GIS 品質要求：

1. 所有底圖必須保留資料來源與授權標示。
2. 不得大量預抓或離線下載 OpenStreetMap 公共 tile。
3. 縣市名稱應先標準化，例如統一使用「臺」而非混用「台」。
4. 未來行政區 Polygon 應使用穩定的行政區代碼 Join。
5. 測站資料應直接使用 CWA 提供的 WGS84 經緯度，不使用人工代表點。

## 8. Application API

| Method | Route | 用途 | 權限 |
| --- | --- | --- | --- |
| `GET` | `/api/weather` | 取得最新 22 縣市預報 | 公開或受 Vercel Protection 保護 |
| `GET` | `/api/status` | 資料庫筆數、縣市數、最後同步狀態 | 建議只提供非敏感狀態 |
| `POST` | `/api/sync` | 手動要求同步；有 5 分鐘保護 | 正式環境建議再加管理員驗證 |
| `GET` | `/api/cron` | Vercel Cron 強制同步 | `Authorization: Bearer <CRON_SECRET>` |

`/api/weather` 回傳格式：

```json
{
  "locations": [
    {
      "locationName": "臺北市",
      "periods": [
        {
          "startTime": "ISO-8601",
          "endTime": "ISO-8601",
          "elements": {
            "Wx": { "label": "天氣現象", "value": "多雲", "unit": null },
            "PoP": { "label": "降雨機率", "value": "20", "unit": "百分比" }
          }
        }
      ]
    }
  ],
  "count": 22
}
```

## 9. 專案結構

```text
app/
├─ api/
│  ├─ weather/route.ts       # 對前端提供氣象資料
│  ├─ status/route.ts        # 資料庫與同步狀態
│  ├─ sync/route.ts          # 手動同步
│  └─ cron/route.ts          # Vercel 排程同步
├─ globals.css
├─ layout.tsx
└─ page.tsx                  # Server Component 首屏載入
components/
└─ WeatherConsole.tsx        # Leaflet、圖層、Popup、tsParticles
lib/
├─ cwa.ts                    # CWA API adapter
├─ weather-store.ts          # 儲存、同步、查詢與 schema
└─ types.ts                  # 共用型別
public/
└─ styles.css                # 主要視覺樣式
vercel.json                  # Vercel Cron 設定
```

## 10. 本機開發

需求：Node.js 20.9 或更新版本。

```powershell
git clone https://github.com/HuangYuhsiang8810/AIoT_0923.git
Set-Location AIoT_0923
npm install
Copy-Item .env.local.example .env.local
npm run dev
```

開啟 <http://localhost:3000>。

`.env.local`：

```dotenv
CWA_API_KEY=your-cwa-api-key
CWA_DATASET_ID=F-C0032-001
DATABASE_URL=postgresql://user:password@host/database?sslmode=require
CRON_SECRET=replace-with-at-least-16-random-characters
```

如果只做本機 UI 開發，可以暫時不設定 `DATABASE_URL`；正式部署不可依賴記憶體暫存。

常用指令：

```powershell
npm run dev
npm run lint
npm run build
npm run start
```

## 11. GitHub 開發流程

建議使用 Feature Branch + Pull Request：

```mermaid
flowchart LR
    ISSUE[需求 / Issue] --> BRANCH[feature branch]
    BRANCH --> CODE[開發與本機測試]
    CODE --> CHECK[npm run lint + npm run build]
    CHECK --> PUSH[Push GitHub]
    PUSH --> PR[Pull Request]
    PR --> PREVIEW[Vercel Preview]
    PREVIEW --> REVIEW[資料與畫面驗收]
    REVIEW --> MAIN[Merge main]
    MAIN --> PROD[Vercel Production]
```

建議分支命名：

- `feature/cwa-observation-layer`
- `feature/neon-storage`
- `fix/weather-sync`
- `docs/system-architecture`

提交前至少執行：

```powershell
npm run lint
npm run build
git status
```

禁止提交：

- `.env`、`.env.local`
- CWA API Key
- `DATABASE_URL`
- `CRON_SECRET`
- `.vercel/`
- `node_modules/`、`.next/`

## 12. Vercel 與 Neon 部署

### 12.1 GitHub 連線部署

1. 將 GitHub repository 匯入 Vercel。
2. Framework Preset 選擇 Next.js。
3. Production Branch 設為 `main`。
4. 設定 Production Environment Variables。
5. 執行 Production Deployment。
6. 每次 PR 先檢查 Preview Deployment；合併 `main` 後自動部署 Production。

Vercel 的 Git 整合會為分支建立 Preview，Production branch 更新後建立正式部署；詳細行為參考[Vercel Git deployments](https://vercel.com/docs/git)。

### 12.2 環境變數

| 名稱 | Production 必要性 | 是否敏感 | 用途 |
| --- | --- | --- | --- |
| `CWA_API_KEY` | 必要 | 是 | CWA API 授權 |
| `CWA_DATASET_ID` | 必要 | 否 | 預設 `F-C0032-001` |
| `DATABASE_URL` | 正式儲存必要 | 是 | Neon PostgreSQL 連線 |
| `CRON_SECRET` | 啟用排程必要 | 是 | 保護 `/api/cron` |

環境變數修改只會套用到之後的新 deployment，因此變更後必須重新部署。參考[Vercel Environment Variables](https://vercel.com/docs/environment-variables)。

### 12.3 Neon 資料庫

1. 在 Vercel Marketplace 建立或連接 Neon。
2. 將 Neon 產生的 Postgres 連線字串指定給本專案的 `DATABASE_URL`。
3. 套用至 Production；需要 Preview DB 時另設 Preview 環境。
4. 重新部署。
5. 第一次呼叫同步 API 時，系統會自動建立 `weather_forecasts`、`sync_runs` 與索引。
6. 檢查 `/api/status` 的 `database.provider` 必須為 `neon`。

### 12.4 Cron

`vercel.json`：

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    {
      "path": "/api/cron",
      "schedule": "5 0 * * *"
    }
  ]
}
```

Vercel 會把 `CRON_SECRET` 自動以 `Authorization: Bearer ...` 送到 route。密鑰至少應為 16 個隨機字元，詳細方式參考[Vercel Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs)。

### 12.5 Deployment Protection

若網站要公開給所有人使用，需在 Vercel Project Settings 檢查 Deployment Protection。關閉保護會改變存取權限，應由專案擁有者確認後再操作。

## 13. 檢驗與驗收

### 13.1 程式品質

```powershell
npm run lint
npm run build
```

驗收標準：兩者皆成功，沒有 TypeScript 或 Next.js build error。

### 13.2 CWA 資料驗證

每次同步至少檢查：

- CWA `success` 為 true。
- 縣市數為 22。
- 每個縣市有 3 個預報時段。
- 每個時段包含 `Wx`、`PoP`、`MinT`、`MaxT`、`CI`。
- 完整資料應為 330 rows。
- `startTime < endTime`。
- `PoP` 為 0–100。
- 溫度可轉為數字且在合理範圍內。
- 不把 CWA 特殊缺值代碼當成正常數值。
- `syncedAt` 與畫面最後更新時間一致。

### 13.3 資料庫驗證

`GET /api/status` 的正式環境期望結果：

```text
database.provider = neon
database.rowCount = 330
database.locationCount = 22
lastRun.status = success
lastRun.recordCount = 330
```

若 `provider = memory`，代表 `DATABASE_URL` 尚未生效或 deployment 尚未重建。

### 13.4 API 驗證

若 Production 啟用了 Deployment Protection，可用已登入的 Vercel CLI：

```powershell
npx vercel curl /api/weather --deployment https://aiot0923.vercel.app
npx vercel curl /api/status --deployment https://aiot0923.vercel.app
```

需要檢查：

- `/api/weather` HTTP 200，`count = 22`。
- `/api/status` HTTP 200，資料庫與最後同步狀態合理。
- `/api/sync` 成功後回傳 `recordCount = 330`。
- 未帶正確 Bearer token 的 `/api/cron` 必須回傳 HTTP 401。

### 13.5 GIS 與畫面驗證

- 臺灣本島與離島可正常平移、縮放。
- OSM attribution 可見且未被面板遮住。
- 22 縣市 marker 位置合理。
- 切換 3 個時段後，標籤與 Popup 同步更新。
- 氣溫、降雨、天氣、舒適度圖層顯示正確。
- 點擊 marker 時，摘要與動態天氣效果一起變更。
- 手機、平板、桌面版面皆可操作。
- 定位功能在使用者拒絕權限時不應造成頁面錯誤。

### 13.6 Production 驗收紀錄

最近一次部署驗證：

```text
Vercel build: PASS
CWA locations: 22
Periods per location: 3
Normalized weather rows: 330
```

## 14. 錯誤處理與維運

| 現象 | 可能原因 | 處理方式 |
| --- | --- | --- |
| 地圖有出現但沒有資料 | Production 缺少 `CWA_API_KEY` | 新增環境變數後重新部署 |
| 顯示 `provider: memory` | 缺少 `DATABASE_URL` | 連接 Neon、設定 Production env、重新部署 |
| Cron 回傳 401 | 缺少或不一致的 `CRON_SECRET` | 設定至少 16 字元的隨機密鑰並重新部署 |
| 瀏覽器看到 Vercel 登入 | Deployment Protection 開啟 | 由專案擁有者決定是否公開 Production |
| OSM 底圖空白 | tile 網路、政策或服務限制 | 檢查 attribution、Referer、tile URL 與用量 |
| CWA 回傳 401/403 | API Key 失效或未設定 | 到 CWA 平臺重新取得授權碼 |
| CWA 回傳成功但資料為空 | 上游格式改變或解析失敗 | 保存舊快照、檢查 logs 與 CWA 公告 |

建議監控：

- Vercel Function error rate 與 response time。
- 最近一次 `sync_runs.status`。
- 資料最後同步時間是否超過 6 小時。
- `weather_forecasts` row count 是否等於預期。
- CWA API 失敗次數與 HTTP status。

## 15. 安全設計

- CWA API Key 只存在 Server-side environment，不放進 `NEXT_PUBLIC_*`。
- 所有敏感變數使用 Vercel Secret 類型。
- `.env*` 已加入 `.gitignore`。
- `/api/cron` 使用 Bearer token 驗證。
- `/api/sync` 正式環境建議增加管理者登入、速率限制或簽章驗證。
- API response 不回傳金鑰、資料庫字串或完整內部錯誤堆疊。
- 若金鑰曾貼在聊天、Issue、Log 或 Commit 中，應立即到 CWA 撤銷並更換。
- Production 與 Preview 建議使用不同資料庫或至少不同 schema。

## 16. 建議開發里程碑

### Phase 1：目前版本

- CWA 36 小時縣市預報
- Leaflet + OpenStreetMap
- 4 種天氣圖層
- 動態天氣效果
- GitHub + Vercel Production

### Phase 2：完成正式資料層

- 連接 Neon PostgreSQL
- 設定 `CRON_SECRET`
- 驗證排程與失敗告警
- 保護 `/api/sync`

### Phase 3：準即時觀測

- 串接 `O-A0003-001`
- 建立 `weather_stations` 與 `station_observations`
- 使用 CWA 測站 WGS84 座標
- 新增氣溫、雨量、風速、風向、溼度圖層
- 顯示資料時間與過期警示

### Phase 4：完整 GIS

- 匯入官方行政區 GeoJSON
- 以縣市代碼進行空間 Join
- 新增縣市 Polygon 色塊與圖例
- 規劃大量使用時的正式 tile provider 或自架圖磚

### Phase 5：CI/CD 與可觀測性

- GitHub Actions 執行 lint、build 與 API contract tests
- Vercel Preview 自動驗收
- Neon migration 管理
- Error tracking、sync latency、資料新鮮度告警

## 17. 參考資料與授權

- [CWA `F-C0032-001` 資料集](https://opendata.cwa.gov.tw/dataset/all/F-C0032-001)
- [CWA `O-A0003-001` 資料集](https://opendata.cwa.gov.tw/dataset/climate/O-A0003-001)
- [CWA 開放資料 API 使用說明](https://opendata.cwa.gov.tw/devManual/insrtuction)
- [CWA 開放資料使用規範](https://opendata.cwa.gov.tw/about/rules)
- [Leaflet API Reference](https://leafletjs.com/reference)
- [OpenStreetMap Copyright and License](https://www.openstreetmap.org/copyright)
- [OpenStreetMap Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/)
- [Vercel Git Deployments](https://vercel.com/docs/git)
- [Vercel Environment Variables](https://vercel.com/docs/environment-variables)
- [Vercel Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs)

氣象資料的權利、更新頻率與使用限制以中央氣象署公告為準；地圖資料須依 OpenStreetMap 的 ODbL 與 attribution 規範使用。
