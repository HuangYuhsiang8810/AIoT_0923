import type { WeatherRow } from '@/lib/types';

export const DEFAULT_DATASET_ID = 'F-C0032-001';
const API_BASE = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore';

type UnknownRecord = Record<string, unknown>;

function first<T>(record: UnknownRecord, names: string[], fallback: T): T {
  for (const name of names) {
    if (name in record) return record[name] as T;
  }
  return fallback;
}

export async function fetchCwaRows(): Promise<WeatherRow[]> {
  const apiKey = process.env.CWA_API_KEY;
  const datasetId = process.env.CWA_DATASET_ID || DEFAULT_DATASET_ID;
  if (!apiKey) throw new Error('缺少 CWA_API_KEY 環境變數');

  const url = new URL(`${API_BASE}/${encodeURIComponent(datasetId)}`);
  url.searchParams.set('Authorization', apiKey);
  url.searchParams.set('format', 'JSON');

  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'cwa-weather-vercel/2.0' },
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`CWA API 回傳 HTTP ${response.status}`);

  const payload = (await response.json()) as UnknownRecord;
  if (String(payload.success).toLowerCase() !== 'true') {
    throw new Error('CWA API 回傳失敗');
  }

  const records = (payload.records || {}) as UnknownRecord;
  let locations = first<unknown>(records, ['location', 'Location'], []);
  if (!Array.isArray(locations) && locations && typeof locations === 'object') {
    locations = first<unknown>(locations as UnknownRecord, ['location', 'Location'], []);
  }
  if (!Array.isArray(locations)) throw new Error('CWA 回傳格式異常：找不到縣市資料');

  const syncedAt = new Date().toISOString();
  const rows: WeatherRow[] = [];
  for (const rawLocation of locations) {
    const location = rawLocation as UnknownRecord;
    const locationName = first(location, ['locationName', 'LocationName'], '');
    const elements = first<unknown[]>(location, ['weatherElement', 'WeatherElement'], []);
    for (const rawElement of elements || []) {
      const element = rawElement as UnknownRecord;
      const elementName = first(element, ['elementName', 'ElementName'], '');
      const periods = first<unknown[]>(element, ['time', 'Time'], []);
      for (const rawPeriod of periods || []) {
        const period = rawPeriod as UnknownRecord;
        const parameter = first<UnknownRecord>(period, ['parameter', 'Parameter'], {});
        const startTime = first(period, ['startTime', 'StartTime'], '');
        const endTime = first(period, ['endTime', 'EndTime'], '');
        const value = first<unknown>(parameter, ['parameterName', 'ParameterName', 'value', 'Value'], null);
        const unit = first<unknown>(parameter, ['parameterUnit', 'ParameterUnit', 'measures', 'Measures'], null);
        if (locationName && elementName && startTime && endTime && value !== null) {
          rows.push({
            datasetId,
            locationName: String(locationName),
            elementName: String(elementName),
            startTime: String(startTime),
            endTime: String(endTime),
            value: String(value),
            unit: unit === null ? null : String(unit),
            syncedAt,
          });
        }
      }
    }
  }
  if (!rows.length) throw new Error('CWA 回傳成功，但沒有可儲存的預報資料');
  return rows;
}
