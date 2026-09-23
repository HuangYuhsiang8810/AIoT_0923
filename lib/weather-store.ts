import { neon } from '@neondatabase/serverless';
import { fetchCwaRows, DEFAULT_DATASET_ID } from '@/lib/cwa';
import type { StatusResponse, WeatherLocation, WeatherResponse, WeatherRow } from '@/lib/types';

const ELEMENT_LABELS: Record<string, string> = {
  Wx: '天氣現象', PoP: '降雨機率', MinT: '最低溫', MaxT: '最高溫', CI: '舒適度',
};
const STALE_AFTER_MS = 3 * 60 * 60 * 1000;
const RESYNC_GUARD_MS = 5 * 60 * 1000;

type MemoryCache = { rows: WeatherRow[]; lastError: string | null };
const runtime = globalThis as typeof globalThis & { __cwaMemory?: MemoryCache; __cwaSchema?: Promise<void> };
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
      );
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
      );
      CREATE INDEX IF NOT EXISTS idx_forecast_location_time
        ON weather_forecasts(location_name, start_time);
    `);
  })();
  return runtime.__cwaSchema;
}

function newestTimestamp(rows: WeatherRow[]): number {
  return rows.length ? new Date(rows[0].syncedAt).getTime() : 0;
}

export async function syncWeather(force = false) {
  const existing = await readRows(false);
  if (!force && Date.now() - newestTimestamp(existing) < RESYNC_GUARD_MS) {
    return { success: true, recordCount: existing.length, syncedAt: existing[0]?.syncedAt ?? null, skipped: true };
  }

  const rows = await fetchCwaRows();
  const sql = sqlClient();
  if (!sql) {
    runtime.__cwaMemory = { rows, lastError: null };
    return { success: true, recordCount: rows.length, syncedAt: rows[0].syncedAt, storage: 'memory' as const };
  }

  await ensureSchema();
  const datasetId = rows[0].datasetId;
  const startedAt = new Date().toISOString();
  const run = await sql.query(
    `INSERT INTO sync_runs(dataset_id, started_at, status) VALUES ($1, $2, 'running') RETURNING id`,
    [datasetId, startedAt],
  ) as { id: string }[];
  const runId = run[0].id;
  try {
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
    return { success: true, recordCount: rows.length, syncedAt: rows[0].syncedAt, storage: 'neon' as const };
  } catch (error) {
    await sql.query(
      `UPDATE sync_runs SET completed_at = NOW(), status = 'failed', error_message = $1 WHERE id = $2`,
      [error instanceof Error ? error.message : String(error), runId],
    );
    throw error;
  }
}

async function readRows(refreshWhenStale = true): Promise<WeatherRow[]> {
  const sql = sqlClient();
  let rows: WeatherRow[];
  if (!sql) {
    rows = runtime.__cwaMemory?.rows ?? [];
  } else {
    await ensureSchema();
    const result = await sql.query(`
      SELECT dataset_id AS "datasetId", location_name AS "locationName", element_name AS "elementName",
             start_time AS "startTime", end_time AS "endTime", value, unit, synced_at AS "syncedAt"
      FROM weather_forecasts
      WHERE dataset_id = $1
        AND synced_at = (SELECT MAX(synced_at) FROM weather_forecasts WHERE dataset_id = $1)
      ORDER BY location_name, start_time, element_name
    `, [process.env.CWA_DATASET_ID || DEFAULT_DATASET_ID]) as WeatherRow[];
    rows = result.map((row) => ({ ...row, syncedAt: new Date(row.syncedAt).toISOString() }));
  }

  if (refreshWhenStale && process.env.CWA_API_KEY && Date.now() - newestTimestamp(rows) > STALE_AFTER_MS) {
    try {
      await syncWeather(true);
      return readRows(false);
    } catch (error) {
      if (!rows.length) throw error;
      runtime.__cwaMemory!.lastError = error instanceof Error ? error.message : String(error);
    }
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
