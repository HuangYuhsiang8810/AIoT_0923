import { neon } from '@neondatabase/serverless';
import { randomUUID } from 'node:crypto';
import { fetchCwaRows, DEFAULT_DATASET_ID } from '@/lib/cwa';
import type { StatusResponse, WeatherLocation, WeatherResponse, WeatherRow } from '@/lib/types';

const ELEMENT_LABELS: Record<string, string> = {
  Wx: '天氣現象', PoP: '降雨機率', MinT: '最低溫', MaxT: '最高溫', CI: '舒適度',
};
const STALE_AFTER_MS = 3 * 60 * 60 * 1000;
const SYNC_LEASE_MS = 90 * 1000;
const SYNC_WAIT_MS = 35 * 1000;
const SYNC_POLL_MS = 500;

type MemoryCache = { rows: WeatherRow[]; lastError: string | null };
type SyncResult = {
  success: true;
  recordCount: number;
  syncedAt: string | null;
  skipped?: true;
  reason?: 'fresh' | 'in-flight';
  storage?: 'memory' | 'neon';
};

const runtime = globalThis as typeof globalThis & {
  __cwaMemory?: MemoryCache;
  __cwaSchema?: Promise<void>;
  __cwaSync?: Promise<SyncResult>;
};
runtime.__cwaMemory ||= { rows: [], lastError: null };

function sqlClient() {
  return process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;
}

async function ensureSchema(): Promise<void> {
  const sql = sqlClient();
  if (!sql) return;
  runtime.__cwaSchema ||= (async () => {
    await sql.query(`
      CREATE TABLE IF NOT EXISTS sync_runs (
        id BIGSERIAL PRIMARY KEY,
        dataset_id TEXT NOT NULL,
        started_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ,
        status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
        record_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT
      )
    `);
    await sql.query(`
      CREATE TABLE IF NOT EXISTS weather_forecasts (
        id BIGSERIAL PRIMARY KEY,
        dataset_id TEXT NOT NULL,
        location_name TEXT NOT NULL,
        element_name TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        value TEXT NOT NULL,
        unit TEXT,
        synced_at TIMESTAMPTZ NOT NULL,
        UNIQUE(dataset_id, location_name, element_name, start_time, end_time)
      )
    `);
    await sql.query(`
      CREATE INDEX IF NOT EXISTS idx_forecast_location_time
        ON weather_forecasts(location_name, start_time)
    `);
    await sql.query(`
      CREATE TABLE IF NOT EXISTS weather_sync_leases (
        dataset_id TEXT PRIMARY KEY,
        token TEXT NOT NULL,
        lease_until TIMESTAMPTZ NOT NULL
      )
    `);
  })().catch((error) => {
    runtime.__cwaSchema = undefined;
    throw error;
  });
  return runtime.__cwaSchema;
}

function newestTimestamp(rows: WeatherRow[]): number {
  return rows.reduce((latest, row) => Math.max(latest, new Date(row.syncedAt).getTime() || 0), 0);
}

function needsRefresh(rows: WeatherRow[]): boolean {
  const newest = newestTimestamp(rows);
  return newest === 0 || Date.now() - newest >= STALE_AFTER_MS;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readStoredRows(): Promise<WeatherRow[]> {
  const sql = sqlClient();
  if (!sql) return runtime.__cwaMemory?.rows ?? [];

  await ensureSchema();
  const result = await sql.query(`
    SELECT dataset_id AS "datasetId", location_name AS "locationName", element_name AS "elementName",
           start_time AS "startTime", end_time AS "endTime", value, unit, synced_at AS "syncedAt"
    FROM weather_forecasts
    WHERE dataset_id = $1
      AND synced_at = (SELECT MAX(synced_at) FROM weather_forecasts WHERE dataset_id = $1)
    ORDER BY location_name, start_time, element_name
  `, [process.env.CWA_DATASET_ID || DEFAULT_DATASET_ID]) as WeatherRow[];
  return result.map((row) => ({ ...row, syncedAt: new Date(row.syncedAt).toISOString() }));
}

async function acquireSyncLease(datasetId: string, token: string): Promise<boolean> {
  const sql = sqlClient();
  if (!sql) return true;
  const result = await sql.query(`
    INSERT INTO weather_sync_leases(dataset_id, token, lease_until)
    VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 millisecond'))
    ON CONFLICT(dataset_id) DO UPDATE
      SET token = EXCLUDED.token, lease_until = EXCLUDED.lease_until
      WHERE weather_sync_leases.lease_until < NOW()
    RETURNING token
  `, [datasetId, token, SYNC_LEASE_MS]) as { token: string }[];
  return result[0]?.token === token;
}

async function releaseSyncLease(datasetId: string, token: string): Promise<void> {
  const sql = sqlClient();
  if (!sql) return;
  await sql.query(`DELETE FROM weather_sync_leases WHERE dataset_id = $1 AND token = $2`, [datasetId, token]);
}

async function waitForConcurrentSync(previousTimestamp: number): Promise<WeatherRow[]> {
  const deadline = Date.now() + SYNC_WAIT_MS;
  while (Date.now() < deadline) {
    await delay(SYNC_POLL_MS);
    const rows = await readStoredRows();
    if (newestTimestamp(rows) > previousTimestamp) return rows;
  }
  return readStoredRows();
}

async function performSync(force: boolean): Promise<SyncResult> {
  const existing = await readStoredRows();
  if (!force && !needsRefresh(existing)) {
    return {
      success: true,
      recordCount: existing.length,
      syncedAt: existing[0]?.syncedAt ?? null,
      skipped: true,
      reason: 'fresh',
    };
  }

  const datasetId = process.env.CWA_DATASET_ID || DEFAULT_DATASET_ID;
  const token = randomUUID();
  if (!(await acquireSyncLease(datasetId, token))) {
    const rows = await waitForConcurrentSync(newestTimestamp(existing));
    if (rows.length) {
      return {
        success: true,
        recordCount: rows.length,
        syncedAt: rows[0]?.syncedAt ?? null,
        skipped: true,
        reason: 'in-flight',
      };
    }
    throw new Error('天氣資料正在由另一個請求更新，請稍後再試');
  }

  const sql = sqlClient();
  let runId: string | null = null;
  try {
    if (sql) {
      const run = await sql.query(
        `INSERT INTO sync_runs(dataset_id, started_at, status) VALUES ($1, NOW(), 'running') RETURNING id`,
        [datasetId],
      ) as { id: string }[];
      runId = run[0].id;
    }

    const rows = await fetchCwaRows();
    if (!sql) {
      runtime.__cwaMemory = { rows, lastError: null };
      return { success: true, recordCount: rows.length, syncedAt: rows[0].syncedAt, storage: 'memory' };
    }

    await sql.query(`
      INSERT INTO weather_forecasts(
        dataset_id, location_name, element_name, start_time, end_time, value, unit, synced_at
      )
      SELECT x.dataset_id, x.location_name, x.element_name, x.start_time, x.end_time, x.value, x.unit, x.synced_at::timestamptz
      FROM jsonb_to_recordset($1::jsonb) AS x(
        dataset_id text, location_name text, element_name text, start_time text, end_time text,
        value text, unit text, synced_at text
      )
      ON CONFLICT(dataset_id, location_name, element_name, start_time, end_time)
      DO UPDATE SET value = EXCLUDED.value, unit = EXCLUDED.unit, synced_at = EXCLUDED.synced_at
    `, [JSON.stringify(rows.map((row) => ({
      dataset_id: row.datasetId, location_name: row.locationName, element_name: row.elementName,
      start_time: row.startTime, end_time: row.endTime, value: row.value, unit: row.unit, synced_at: row.syncedAt,
    })))]);
    await sql.query(`DELETE FROM weather_forecasts WHERE dataset_id = $1 AND synced_at < $2::timestamptz`, [datasetId, rows[0].syncedAt]);
    await sql.query(
      `UPDATE sync_runs SET completed_at = $1, status = 'success', record_count = $2 WHERE id = $3`,
      [rows[0].syncedAt, rows.length, runId],
    );
    return { success: true, recordCount: rows.length, syncedAt: rows[0].syncedAt, storage: 'neon' };
  } catch (error) {
    if (sql && runId) {
      await sql.query(
        `UPDATE sync_runs SET completed_at = NOW(), status = 'failed', error_message = $1 WHERE id = $2`,
        [error instanceof Error ? error.message : String(error), runId],
      );
    }
    throw error;
  } finally {
    await releaseSyncLease(datasetId, token).catch(() => undefined);
  }
}

export function syncWeather(force = false): Promise<SyncResult> {
  if (runtime.__cwaSync) return runtime.__cwaSync;
  const promise = performSync(force).finally(() => {
    if (runtime.__cwaSync === promise) runtime.__cwaSync = undefined;
  });
  runtime.__cwaSync = promise;
  return promise;
}

async function readRows(refreshWhenStale = true): Promise<WeatherRow[]> {
  let rows = await readStoredRows();
  if (!refreshWhenStale || !process.env.CWA_API_KEY || !needsRefresh(rows)) return rows;

  try {
    await syncWeather(false);
    rows = await readStoredRows();
  } catch (error) {
    if (!rows.length) throw error;
    runtime.__cwaMemory!.lastError = error instanceof Error ? error.message : String(error);
  }
  return rows;
}

export async function getWeather(): Promise<WeatherResponse> {
  const rows = await readRows();
  const grouped = new Map<string, WeatherLocation>();
  for (const row of rows) {
    let location = grouped.get(row.locationName);
    if (!location) {
      location = { locationName: row.locationName, periods: [] };
      grouped.set(row.locationName, location);
    }
    let period = location.periods.find((item) => item.startTime === row.startTime && item.endTime === row.endTime);
    if (!period) {
      period = { startTime: row.startTime, endTime: row.endTime, elements: {} };
      location.periods.push(period);
    }
    period.elements[row.elementName] = {
      label: ELEMENT_LABELS[row.elementName] || row.elementName,
      value: row.value,
      unit: row.unit,
    };
  }
  const locations = [...grouped.values()];
  return { locations, count: locations.length };
}

export async function getStatus(): Promise<StatusResponse> {
  const sql = sqlClient();
  if (!sql) {
    const rows = runtime.__cwaMemory?.rows ?? [];
    return {
      database: { provider: 'memory', rowCount: rows.length, locationCount: new Set(rows.map((row) => row.locationName)).size, syncedAt: rows[0]?.syncedAt ?? null },
      lastRun: rows.length ? { status: 'success', recordCount: rows.length, errorMessage: runtime.__cwaMemory?.lastError ?? null, completedAt: rows[0].syncedAt } : null,
    };
  }
  await ensureSchema();
  const [summary, runs] = await Promise.all([
    sql.query(`SELECT COUNT(*)::int AS "rowCount", COUNT(DISTINCT location_name)::int AS "locationCount", MAX(synced_at) AS "syncedAt" FROM weather_forecasts`),
    sql.query(`SELECT status, record_count AS "recordCount", error_message AS "errorMessage", completed_at AS "completedAt" FROM sync_runs ORDER BY id DESC LIMIT 1`),
  ]);
  const info = summary[0] as { rowCount: number; locationCount: number; syncedAt: string | null };
  const run = runs[0] as StatusResponse['lastRun'];
  return {
    database: { provider: 'neon', rowCount: info.rowCount, locationCount: info.locationCount, syncedAt: info.syncedAt ? new Date(info.syncedAt).toISOString() : null },
    lastRun: run ? { ...run, completedAt: run.completedAt ? new Date(run.completedAt).toISOString() : null } : null,
  };
}
