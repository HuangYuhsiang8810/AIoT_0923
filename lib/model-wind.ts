import { neon } from '@neondatabase/serverless';
import { randomUUID } from 'node:crypto';
import type { WindGridRecord, WindResponse } from '@/lib/types';

const SOURCE_ID = 'ecmwf_ifs';
const SOURCE_NAME = 'ECMWF IFS HRES 9 km' as const;
const PUBLIC_API = 'https://api.open-meteo.com/v1/ecmwf';
const CUSTOMER_API = 'https://customer-api.open-meteo.com/v1/ecmwf';
const REFRESH_MS = 3 * 60 * 60 * 1000;
const ERROR_RETRY_MS = 10 * 60 * 1000;
const LEASE_MS = 2 * 60 * 1000;
const WAIT_MS = 45 * 1000;
const BATCH_SIZE = 900;
const BOUNDS = { west: 105, east: 141, south: 14, north: 33 } as const;
// The source model is 9 km. The display grid is intentionally sampled at 1° so
// one refresh stays within the upstream multi-location fair-use limit.
const GRID_STEP = 1;

type ApiLocation = {
  hourly?: {
    time?: unknown[];
    wind_speed_10m?: unknown[];
    wind_direction_10m?: unknown[];
  };
};

type StoredWind = WindResponse & { fetchedAt: string };
type MemoryCache = { value: StoredWind; expiresAt: number };

const runtime = globalThis as typeof globalThis & {
  __modelWindCache?: MemoryCache;
  __modelWindRequest?: Promise<WindResponse>;
  __modelWindSchema?: Promise<void>;
};

function sqlClient() {
  return process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;
}

async function ensureSchema(): Promise<void> {
  const sql = sqlClient();
  if (!sql) return;
  runtime.__modelWindSchema ||= (async () => {
    await sql.query(`
      CREATE TABLE IF NOT EXISTS wind_fields (
        source_id TEXT PRIMARY KEY,
        source_name TEXT NOT NULL,
        observed_at TIMESTAMPTZ NOT NULL,
        checked_at TIMESTAMPTZ NOT NULL,
        fetched_at TIMESTAMPTZ NOT NULL,
        point_count INTEGER NOT NULL,
        max_speed DOUBLE PRECISION NOT NULL,
        sample_step DOUBLE PRECISION NOT NULL,
        records JSONB NOT NULL
      )
    `);
    await sql.query(`
      CREATE TABLE IF NOT EXISTS wind_sync_leases (
        source_id TEXT PRIMARY KEY,
        token TEXT NOT NULL,
        lease_until TIMESTAMPTZ NOT NULL
      )
    `);
  })().catch((error) => {
    runtime.__modelWindSchema = undefined;
    throw error;
  });
  return runtime.__modelWindSchema;
}

function isFresh(value: Pick<StoredWind, 'checkedAt'>): boolean {
  const checkedAt = new Date(value.checkedAt).getTime();
  return Number.isFinite(checkedAt) && Date.now() - checkedAt < REFRESH_MS;
}

function cache(value: StoredWind, ttl = REFRESH_MS): StoredWind {
  runtime.__modelWindCache = { value, expiresAt: Date.now() + ttl };
  return value;
}

function parseRecords(value: unknown): [WindGridRecord, WindGridRecord] | null {
  let records = value;
  if (typeof records === 'string') {
    try { records = JSON.parse(records); } catch { return null; }
  }
  if (!Array.isArray(records) || records.length !== 2) return null;
  return records as [WindGridRecord, WindGridRecord];
}

async function readStored(): Promise<StoredWind | null> {
  const memory = runtime.__modelWindCache?.value;
  const sql = sqlClient();
  if (!sql) return memory ?? null;

  await ensureSchema();
  const rows = await sql.query(`
    SELECT source_name AS "source", observed_at AS "observedAt", checked_at AS "checkedAt",
           fetched_at AS "fetchedAt", point_count AS "pointCount", max_speed AS "maxSpeed",
           sample_step AS "sampleStep", records
    FROM wind_fields WHERE source_id = $1
  `, [SOURCE_ID]) as Array<Omit<StoredWind, 'records'> & { records: unknown }>;
  const row = rows[0];
  if (!row) return memory ?? null;
  const records = parseRecords(row.records);
  if (!records) return memory ?? null;
  return {
    records,
    source: SOURCE_NAME,
    observedAt: new Date(row.observedAt).toISOString(),
    checkedAt: new Date(row.checkedAt).toISOString(),
    fetchedAt: new Date(row.fetchedAt).toISOString(),
    pointCount: Number(row.pointCount),
    maxSpeed: Number(row.maxSpeed),
    sampleStep: Number(row.sampleStep),
  };
}

async function acquireLease(token: string): Promise<boolean> {
  const sql = sqlClient();
  if (!sql) return true;
  await ensureSchema();
  const rows = await sql.query(`
    INSERT INTO wind_sync_leases(source_id, token, lease_until)
    VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 millisecond'))
    ON CONFLICT(source_id) DO UPDATE
      SET token = EXCLUDED.token, lease_until = EXCLUDED.lease_until
      WHERE wind_sync_leases.lease_until < NOW()
    RETURNING token
  `, [SOURCE_ID, token, LEASE_MS]) as { token: string }[];
  return rows[0]?.token === token;
}

async function releaseLease(token: string): Promise<void> {
  const sql = sqlClient();
  if (!sql) return;
  await sql.query('DELETE FROM wind_sync_leases WHERE source_id = $1 AND token = $2', [SOURCE_ID, token]);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForConcurrentUpdate(previousCheckedAt: string | undefined): Promise<StoredWind | null> {
  const previous = new Date(previousCheckedAt ?? 0).getTime();
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    await delay(750);
    const stored = await readStored();
    if (stored && new Date(stored.checkedAt).getTime() > previous) return stored;
  }
  return readStored();
}

function createCoordinates(): Array<{ latitude: number; longitude: number }> {
  const nx = Math.round((BOUNDS.east - BOUNDS.west) / GRID_STEP) + 1;
  const ny = Math.round((BOUNDS.north - BOUNDS.south) / GRID_STEP) + 1;
  return Array.from({ length: nx * ny }, (_, index) => ({
    latitude: BOUNDS.north - Math.floor(index / nx) * GRID_STEP,
    longitude: BOUNDS.west + (index % nx) * GRID_STEP,
  }));
}

async function fetchBatch(coordinates: Array<{ latitude: number; longitude: number }>): Promise<ApiLocation[]> {
  const apiKey = process.env.OPEN_METEO_API_KEY;
  const body = new URLSearchParams({
    latitude: coordinates.map((item) => item.latitude).join(','),
    longitude: coordinates.map((item) => item.longitude).join(','),
    hourly: 'wind_speed_10m,wind_direction_10m',
    wind_speed_unit: 'ms',
    models: SOURCE_ID,
    cell_selection: 'nearest',
    elevation: coordinates.map(() => 'nan').join(','),
    forecast_hours: '1',
    timezone: 'GMT',
  });
  if (apiKey) body.set('apikey', apiKey);

  let response: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetch(apiKey ? CUSTOMER_API : PUBLIC_API, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'cwa-weather-vercel/3.0',
      },
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(45_000),
    });
    if (response.status !== 429 || attempt === 2) break;
    await delay((attempt + 1) * 2_000);
  }
  if (!response?.ok) throw new Error(`ECMWF 風場服務回傳 HTTP ${response?.status ?? 'unknown'}`);
  const payload = await response.json() as ApiLocation | ApiLocation[] | { error?: boolean; reason?: string };
  if (!Array.isArray(payload)) {
    if ('error' in payload && payload.error) throw new Error(payload.reason || 'ECMWF 風場服務拒絕請求');
    return [payload as ApiLocation];
  }
  if (payload.length !== coordinates.length) throw new Error(`ECMWF 風場點數不完整：${payload.length}/${coordinates.length}`);
  return payload;
}

async function fetchModelWind(): Promise<StoredWind> {
  const coordinates = createCoordinates();
  const batches: Array<Array<{ latitude: number; longitude: number }>> = [];
  for (let index = 0; index < coordinates.length; index += BATCH_SIZE) {
    batches.push(coordinates.slice(index, index + BATCH_SIZE));
  }
  const responses: ApiLocation[] = [];
  for (const batch of batches) responses.push(...await fetchBatch(batch));
  if (responses.length !== coordinates.length) {
    throw new Error(`ECMWF 區域風場不完整：${responses.length}/${coordinates.length}`);
  }

  const uData: number[] = [];
  const vData: number[] = [];
  let observedAt = '';
  let maxSpeed = 0;
  for (const location of responses) {
    const time = String(location.hourly?.time?.[0] ?? '');
    const speed = Number(location.hourly?.wind_speed_10m?.[0]);
    const direction = Number(location.hourly?.wind_direction_10m?.[0]);
    if (!time || !Number.isFinite(speed) || speed < 0 || speed > 150 || !Number.isFinite(direction) || direction < 0 || direction > 360) {
      throw new Error('ECMWF 風場包含無效的時間、風速或風向，已保留上一版資料');
    }
    const timestamp = time.endsWith('Z') ? time : `${time}Z`;
    if (observedAt && observedAt !== timestamp) throw new Error('ECMWF 風場時間切片不一致，已保留上一版資料');
    observedAt = timestamp;
    const radians = (direction % 360) * Math.PI / 180;
    uData.push(Number((-speed * Math.sin(radians)).toFixed(3)));
    vData.push(Number((-speed * Math.cos(radians)).toFixed(3)));
    maxSpeed = Math.max(maxSpeed, speed);
  }

  const modelTime = new Date(observedAt).getTime();
  if (!Number.isFinite(modelTime) || modelTime < Date.now() - 6 * 60 * 60 * 1000 || modelTime > Date.now() + 2 * 60 * 60 * 1000) {
    throw new Error(`ECMWF 模式時間異常（${observedAt}），已保留上一版資料`);
  }

  const nx = Math.round((BOUNDS.east - BOUNDS.west) / GRID_STEP) + 1;
  const ny = Math.round((BOUNDS.north - BOUNDS.south) / GRID_STEP) + 1;
  const header: Omit<WindGridRecord['header'], 'parameterNumber'> = {
    parameterCategory: 2,
    nx,
    ny,
    lo1: BOUNDS.west,
    lo2: BOUNDS.east,
    la1: BOUNDS.north,
    la2: BOUNDS.south,
    dx: GRID_STEP,
    dy: GRID_STEP,
    refTime: observedAt,
    forecastTime: 0,
  };
  const now = new Date().toISOString();
  return {
    records: [
      { header: { ...header, parameterNumber: 2 }, data: uData },
      { header: { ...header, parameterNumber: 3 }, data: vData },
    ],
    source: SOURCE_NAME,
    observedAt,
    checkedAt: now,
    fetchedAt: now,
    pointCount: coordinates.length,
    maxSpeed: Number(maxSpeed.toFixed(1)),
    sampleStep: GRID_STEP,
  };
}

async function persist(value: StoredWind): Promise<void> {
  const sql = sqlClient();
  if (!sql) return;
  await ensureSchema();
  await sql.query(`
    INSERT INTO wind_fields(
      source_id, source_name, observed_at, checked_at, fetched_at,
      point_count, max_speed, sample_step, records
    ) VALUES ($1, $2, $3::timestamptz, $4::timestamptz, $5::timestamptz, $6, $7, $8, $9::jsonb)
    ON CONFLICT(source_id) DO UPDATE SET
      source_name = EXCLUDED.source_name,
      observed_at = EXCLUDED.observed_at,
      checked_at = EXCLUDED.checked_at,
      fetched_at = EXCLUDED.fetched_at,
      point_count = EXCLUDED.point_count,
      max_speed = EXCLUDED.max_speed,
      sample_step = EXCLUDED.sample_step,
      records = EXCLUDED.records
  `, [
    SOURCE_ID, value.source, value.observedAt, value.checkedAt, value.fetchedAt,
    value.pointCount, value.maxSpeed, value.sampleStep, JSON.stringify(value.records),
  ]);
}

async function refreshWind(previous: StoredWind | null): Promise<WindResponse> {
  const token = randomUUID();
  if (!(await acquireLease(token))) {
    const concurrent = await waitForConcurrentUpdate(previous?.checkedAt);
    if (concurrent) return cache(concurrent);
    throw new Error('風場正在由另一個請求更新，請稍後再試');
  }

  try {
    const value = await fetchModelWind();
    await persist(value);
    return cache(value);
  } catch (error) {
    if (!previous) throw error;
    const stale = { ...previous, stale: true };
    cache(stale, ERROR_RETRY_MS);
    return stale;
  } finally {
    await releaseLease(token).catch(() => undefined);
  }
}

export async function getWindField(): Promise<WindResponse> {
  const memory = runtime.__modelWindCache;
  if (memory && memory.expiresAt > Date.now()) return memory.value;
  if (runtime.__modelWindRequest) return runtime.__modelWindRequest;

  const request = (async () => {
    const stored = await readStored();
    if (stored && isFresh(stored)) {
      const remaining = Math.max(1_000, REFRESH_MS - (Date.now() - new Date(stored.checkedAt).getTime()));
      return cache(stored, remaining);
    }
    return refreshWind(stored);
  })().finally(() => {
    if (runtime.__modelWindRequest === request) runtime.__modelWindRequest = undefined;
  });
  runtime.__modelWindRequest = request;
  return request;
}
