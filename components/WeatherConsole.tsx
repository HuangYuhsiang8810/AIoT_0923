'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tsParticles } from '@tsparticles/engine';
import { loadSlim } from '@tsparticles/slim';
import type { CircleMarker, Map as LeafletMap, Marker, TileLayer } from 'leaflet';
import type { StatusResponse, WeatherLocation, WeatherPeriod, WeatherResponse } from '@/lib/types';

const CITY_COORDS: Record<string, [number, number]> = {
  基隆市: [25.1283, 121.7419], 臺北市: [25.0375, 121.5637], 新北市: [25.012, 121.4657],
  桃園市: [24.9937, 121.301], 新竹市: [24.8138, 120.9675], 新竹縣: [24.8387, 121.0177],
  苗栗縣: [24.5602, 120.8214], 臺中市: [24.1477, 120.6736], 彰化縣: [24.0756, 120.544],
  南投縣: [23.9609, 120.9719], 雲林縣: [23.7092, 120.4313], 嘉義市: [23.4801, 120.4491],
  嘉義縣: [23.4518, 120.2555], 臺南市: [22.9999, 120.227], 高雄市: [22.6273, 120.3014],
  屏東縣: [22.5519, 120.5488], 宜蘭縣: [24.7021, 121.7378], 花蓮縣: [23.9911, 121.6112],
  臺東縣: [22.7554, 121.15], 澎湖縣: [23.5712, 119.5793], 金門縣: [24.4494, 118.3767],
  連江縣: [26.1605, 119.9517],
};

type LayerName = 'temperature' | 'rain' | 'weather' | 'comfort';
type WeatherMood = 'sunny' | 'cloudy' | 'rain' | 'storm';
type Destroyable = { destroy: () => void };

function elementValue(period: WeatherPeriod | undefined, name: string, fallback = '—') {
  return period?.elements?.[name]?.value ?? fallback;
}

function weatherIcon(value = '') {
  if (/雷/.test(value)) return '⛈️';
  if (/雨/.test(value)) return '🌧️';
  if (/陰/.test(value)) return '☁️';
  if (/雲/.test(value)) return '🌥️';
  if (/晴/.test(value)) return '☀️';
  return '🌤️';
}

function weatherMood(value = ''): WeatherMood {
  if (/雷/.test(value)) return 'storm';
  if (/雨/.test(value)) return 'rain';
  if (/陰|雲/.test(value)) return 'cloudy';
  return 'sunny';
}

function formatTime(value?: string | null, full = false) {
  if (!value) return '—';
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const date = new Date(normalized);
  return new Intl.DateTimeFormat('zh-TW', full
    ? { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }
    : { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }
  ).format(date);
}

function temperatureColor(value: string) {
  const temp = Number(value);
  if (temp <= 16) return '#80cce4';
  if (temp <= 21) return '#a9df9b';
  if (temp <= 25) return '#d9ed83';
  if (temp <= 29) return '#ffd278';
  if (temp <= 32) return '#ff9c5b';
  return '#f25d4a';
}

function rainColor(value: string) {
  const rain = Number(value);
  if (rain < 20) return '#b8dbe0';
  if (rain < 40) return '#80cce4';
  if (rain < 60) return '#4da9df';
  if (rain < 80) return '#567dd6';
  return '#9b6fd0';
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[character] || character));
}

function markerView(location: WeatherLocation, periodIndex: number, layer: LayerName) {
  const period = location.periods[periodIndex] || location.periods[0];
  if (layer === 'rain') {
    const value = elementValue(period, 'PoP');
    return { text: `${value}%`, color: rainColor(value), className: '' };
  }
  if (layer === 'weather') return { text: weatherIcon(elementValue(period, 'Wx')), color: '#eef3e5', className: 'weather-value' };
  if (layer === 'comfort') {
    const value = elementValue(period, 'CI');
    return { text: value.includes('舒適') ? '舒適' : value.slice(0, 3), color: value.includes('悶熱') ? '#ffa66d' : '#c9eaaa', className: '' };
  }
  const value = elementValue(period, 'MaxT');
  return { text: `${value}°`, color: temperatureColor(value), className: '' };
}

function popupHtml(location: WeatherLocation, periodIndex: number) {
  const period = location.periods[periodIndex] || location.periods[0];
  return `<div class="weather-popup">
    <h2 class="popup-title">${escapeHtml(location.locationName)}</h2>
    <p class="popup-time">${formatTime(period.startTime, true)} 至 ${formatTime(period.endTime, true)}</p>
    <div class="popup-row"><span>天氣現象</span><strong>${weatherIcon(elementValue(period, 'Wx'))} ${escapeHtml(elementValue(period, 'Wx'))}</strong></div>
    <div class="popup-row"><span>氣溫</span><strong>${escapeHtml(elementValue(period, 'MinT'))}–${escapeHtml(elementValue(period, 'MaxT'))} °C</strong></div>
    <div class="popup-row"><span>降雨機率</span><strong>${escapeHtml(elementValue(period, 'PoP'))}%</strong></div>
    <div class="popup-row"><span>舒適度</span><strong>${escapeHtml(elementValue(period, 'CI'))}</strong></div>
  </div>`;
}

function particleOptions(mood: WeatherMood) {
  const base = {
    fullScreen: { enable: false }, detectRetina: true, fpsLimit: 45,
    background: { color: { value: 'transparent' } },
    interactivity: { events: { onHover: { enable: false }, onClick: { enable: false }, resize: { enable: true } } },
  };
  if (mood === 'rain' || mood === 'storm') return {
    ...base,
    particles: {
      number: { value: mood === 'storm' ? 120 : 82, density: { enable: true, width: 1400, height: 900 } },
      color: { value: mood === 'storm' ? '#d9e1ff' : '#b7dcfa' }, shape: { type: 'circle' },
      opacity: { value: { min: 0.18, max: 0.62 } }, size: { value: { min: 0.7, max: 1.8 } },
      move: { enable: true, direction: 'bottom-left', speed: { min: 13, max: 23 }, straight: true, outModes: { default: 'out' } },
    },
  };
  if (mood === 'cloudy') return {
    ...base,
    particles: {
      number: { value: 38, density: { enable: true, width: 1400, height: 900 } },
      color: { value: ['#dce5e5', '#aab8bd'] }, shape: { type: 'circle' },
      opacity: { value: { min: 0.025, max: 0.14 }, animation: { enable: true, speed: 0.25 } },
      size: { value: { min: 0.8, max: 3.2 } },
      move: { enable: true, direction: 'right', speed: { min: 0.18, max: 0.55 }, straight: false, outModes: { default: 'out' } },
    },
  };
  return {
    ...base,
    particles: {
      number: { value: 28, density: { enable: true, width: 1400, height: 900 } },
      color: { value: ['#fff0a8', '#ffd46b', '#ffffff'] }, shape: { type: 'circle' },
      opacity: { value: { min: 0.08, max: 0.36 }, animation: { enable: true, speed: 0.5 } },
      size: { value: { min: 0.8, max: 2.8 } },
      move: { enable: true, direction: 'top-right', speed: { min: 0.15, max: 0.55 }, outModes: { default: 'out' } },
    },
  };
}

type WeatherConsoleProps = {
  initialWeather: WeatherResponse;
  initialStatus: StatusResponse | null;
  initialError?: string;
};

export default function WeatherConsole({ initialWeather, initialStatus, initialError = '' }: WeatherConsoleProps) {
  const [locations, setLocations] = useState<WeatherLocation[]>(initialWeather.locations);
  const [status, setStatus] = useState<StatusResponse | null>(initialStatus);
  const [periodIndex, setPeriodIndex] = useState(0);
  const [layer, setLayer] = useState<LayerName>('temperature');
  const [baseMap, setBaseMap] = useState<'dark' | 'street'>('dark');
  const [labelsEnabled, setLabelsEnabled] = useState(true);
  const [tintEnabled, setTintEnabled] = useState(true);
  const [effectsEnabled, setEffectsEnabled] = useState(true);
  const [selectedWeather, setSelectedWeather] = useState<string | null>(null);
  const [notice, setNotice] = useState(initialError);
  const [syncing, setSyncing] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const mapHostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const tileRef = useRef<TileLayer | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const userMarkerRef = useRef<CircleMarker | null>(null);
  const effectRef = useRef<Destroyable | null>(null);
  const particlesReadyRef = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    const weatherResponse = await fetch('/api/weather', { cache: 'no-store' });
    const weather = await weatherResponse.json() as WeatherResponse & { error?: string };
    if (!weatherResponse.ok) throw new Error(weather.error || '天氣資料讀取失敗');
    setLocations(weather.locations);
    const statusResponse = await fetch('/api/status', { cache: 'no-store' });
    const nextStatus = await statusResponse.json() as StatusResponse & { error?: string };
    if (!statusResponse.ok) throw new Error(nextStatus.error || '同步狀態讀取失敗');
    setStatus(nextStatus);
  }, []);

  useEffect(() => {
    if (initialWeather.locations.length && initialStatus) return;
    // refresh only updates state after network awaits; the rule cannot infer that through useCallback.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh().catch((error: Error) => setNotice(error.message));
  }, [refresh, initialWeather.locations.length, initialStatus]);

  useEffect(() => {
    if (!mapHostRef.current || mapRef.current) return;
    let cancelled = false;
    void import('leaflet').then((L) => {
      if (cancelled || !mapHostRef.current) return;
      const map = L.map(mapHostRef.current, { zoomControl: true, zoomSnap: 0.25, minZoom: 6, maxZoom: 13 }).setView([23.75, 120.85], 8);
      const tile = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors', maxZoom: 19,
      }).addTo(map);
      map.on('popupclose', () => setSelectedWeather(null));
      mapRef.current = map;
      tileRef.current = tile;
      setMapReady(true);
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    mapHostRef.current?.classList.toggle('dark-basemap', baseMap === 'dark');
  }, [baseMap, mapReady]);

  useEffect(() => {
    mapHostRef.current?.classList.toggle('markers-hidden', !labelsEnabled);
  }, [labelsEnabled]);

  useEffect(() => {
    if (!mapRef.current || !mapReady) return;
    let cancelled = false;
    void import('leaflet').then((L) => {
      if (cancelled || !mapRef.current) return;
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = locations.flatMap((location) => {
        const coords = CITY_COORDS[location.locationName];
        if (!coords || !mapRef.current) return [];
        const view = markerView(location, periodIndex, layer);
        const icon = L.divIcon({
          className: 'weather-marker', iconSize: [1, 1], iconAnchor: [0, 0],
          html: `<span class="marker-label ${view.className}" style="--marker-color:${view.color}">${escapeHtml(view.text)}</span>`,
        });
        const marker = L.marker(coords, { icon, keyboard: true, title: location.locationName })
          .addTo(mapRef.current)
          .bindPopup(() => popupHtml(location, periodIndex), { offset: [0, -8] });
        marker.on('click', () => {
          const period = location.periods[periodIndex] || location.periods[0];
          setSelectedWeather(elementValue(period, 'Wx'));
        });
        return [marker];
      });
    });
    return () => { cancelled = true; };
  }, [locations, periodIndex, layer, mapReady]);

  const rows = useMemo(() => locations.map((location) => ({
    location, period: location.periods[periodIndex] || location.periods[0],
  })).filter((row) => row.period), [locations, periodIndex]);

  const dashboard = useMemo(() => {
    if (!rows.length) return null;
    const highest = rows.reduce((a, b) => Number(elementValue(a.period, 'MaxT', '-99')) > Number(elementValue(b.period, 'MaxT', '-99')) ? a : b);
    const lowest = rows.reduce((a, b) => Number(elementValue(a.period, 'MinT', '99')) < Number(elementValue(b.period, 'MinT', '99')) ? a : b);
    const rainiest = rows.reduce((a, b) => Number(elementValue(a.period, 'PoP', '-1')) > Number(elementValue(b.period, 'PoP', '-1')) ? a : b);
    const counts = rows.reduce<Record<string, number>>((result, row) => {
      const weather = elementValue(row.period, 'Wx');
      result[weather] = (result[weather] || 0) + 1;
      return result;
    }, {});
    const [mainWeather, mainCount] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return { highest, lowest, rainiest, mainWeather, mainCount, firstPeriod: rows[0].period };
  }, [rows]);

  const activeWeather = selectedWeather || dashboard?.mainWeather || '';
  useEffect(() => {
    const mood = weatherMood(activeWeather);
    document.body.dataset.weather = mood;
    if (!effectsEnabled || !activeWeather) {
      effectRef.current?.destroy();
      effectRef.current = null;
      return;
    }
    let cancelled = false;
    particlesReadyRef.current ||= loadSlim(tsParticles);
    void particlesReadyRef.current.then(async () => {
      if (cancelled) return;
      effectRef.current?.destroy();
      const container = await tsParticles.load({ id: 'weather-effects', options: particleOptions(mood) as never });
      if (cancelled) container?.destroy();
      else effectRef.current = container ?? null;
    }).catch(() => setNotice('粒子套件載入失敗，已改用 CSS 天氣效果。'));
    return () => {
      cancelled = true;
      effectRef.current?.destroy();
      effectRef.current = null;
    };
  }, [activeWeather, effectsEnabled]);

  const periods = locations[0]?.periods || [];
  const legend = {
    temperature: { unit: '°C', values: ['10', '18', '24', '30', '36'], gradient: 'linear-gradient(90deg,#3989ba,#78bbbd,#c4dd82,#ffd370,#ff8449,#ec3c33)' },
    rain: { unit: '%', values: ['0', '20', '40', '60', '100'], gradient: 'linear-gradient(90deg,#b8dbe0,#80cce4,#4da9df,#567dd6,#9b6fd0)' },
    weather: { unit: '天氣', values: ['晴', '多雲', '陰', '雨'], gradient: 'linear-gradient(90deg,#ffd36f,#dce2cf,#9ba8b7,#5f78a7)' },
    comfort: { unit: '體感', values: ['寒冷', '舒適', '稍熱', '悶熱'], gradient: 'linear-gradient(90deg,#7fcbe1,#c9eaaa,#ffd178,#ffa06b)' },
  }[layer];

  async function syncNow() {
    setSyncing(true);
    setNotice('');
    try {
      const response = await fetch('/api/sync', { method: 'POST' });
      const result = await response.json() as { error?: string; recordCount?: number };
      if (!response.ok) throw new Error(result.error || '同步失敗');
      setNotice(`同步完成，已整理 ${result.recordCount ?? 0} 筆資料。`);
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setSyncing(false);
    }
  }

  function locate() {
    if (!mapRef.current || !navigator.geolocation) return setNotice('瀏覽器無法使用定位功能。');
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      const L = await import('leaflet');
      userMarkerRef.current?.remove();
      userMarkerRef.current = L.circleMarker([coords.latitude, coords.longitude], {
        radius: 8, color: '#fff', weight: 3, fillColor: '#0fa47b', fillOpacity: 1,
      }).addTo(mapRef.current!).bindPopup('你的位置').openPopup();
      mapRef.current!.setView([coords.latitude, coords.longitude], 10);
    }, () => setNotice('無法取得位置，請確認瀏覽器定位權限。'));
  }

  return <main className="weather-console">
    <div id="map" ref={mapHostRef} aria-label="台灣縣市天氣預報地圖" />
    {!mapReady && <div id="map-fallback" aria-hidden="true"><div className="fallback-grid" /><svg viewBox="0 0 900 900"><path className="island" d="M544 48 604 91 644 166 689 229 674 318 712 384 678 466 644 525 631 610 579 691 547 776 480 851 438 784 420 698 380 634 394 548 361 474 387 397 401 313 445 242 462 161 506 105Z"/><path className="ridge" d="M537 103 555 196 531 285 572 370 531 474 557 570 509 675 492 788"/><path className="county-line" d="M425 267 652 238M390 398 679 374M382 518 649 524M421 660 589 672"/></svg><p>地圖底圖載入中…</p></div>}
    <div className={`map-tint ${tintEnabled ? '' : 'hidden'}`} id="map-tint" />
    <div id="weather-effects" className={effectsEnabled ? '' : 'hidden'} aria-hidden="true" />

    <section className="summary-panel glass-panel" aria-labelledby="summary-title">
      <div className="panel-heading"><div><p className="panel-kicker">CWA OPEN DATA</p><h1 id="summary-title">台灣縣市預報</h1></div><span className="source-badge">{status?.database.provider === 'neon' ? 'Neon DB' : '開發模式'}</span></div>
      <dl className="dataset-meta">
        <div><dt>預報起始</dt><dd>{formatTime(dashboard?.firstPeriod.startTime, true)}</dd></div>
        <div><dt>資料來源</dt><dd>CWA F-C0032-001</dd></div>
        <div><dt>本次讀取</dt><dd>{status?.lastRun?.status === 'success' ? `成功（${status.database.rowCount} 筆）` : '資料讀取中'}</dd></div>
        <div><dt>儲存架構</dt><dd>{status?.database.provider === 'neon' ? 'Vercel + Neon Postgres' : '本機記憶體'}</dd></div>
      </dl>
      <div className="metric-grid">
        <article><span>最高溫</span><strong>{elementValue(dashboard?.highest.period, 'MaxT')}<small> °C</small></strong><small>{dashboard?.highest.location.locationName || '—'}</small></article>
        <article><span>最低溫</span><strong>{elementValue(dashboard?.lowest.period, 'MinT')}<small> °C</small></strong><small>{dashboard?.lowest.location.locationName || '—'}</small></article>
        <article><span>最高降雨機率</span><strong>{elementValue(dashboard?.rainiest.period, 'PoP')}<small> %</small></strong><small>{dashboard?.rainiest.location.locationName || '—'}</small></article>
        <article><span>主要天氣</span><strong className="text-metric">{weatherIcon(dashboard?.mainWeather)} {dashboard?.mainWeather || '—'}</strong><small>{dashboard ? `${dashboard.mainCount} 個縣市` : '—'}</small></article>
      </div>
    </section>

    <section className="period-bar glass-panel" aria-label="預報時段選擇"><div className="period-title"><span>▲</span><strong>未來 36 小時</strong><em>{periods.length} 個預報時段</em></div><div className="period-switch">{periods.map((period, index) => <button key={period.startTime} className={`period-button ${index === periodIndex ? 'active' : ''}`} onClick={() => { setPeriodIndex(index); setSelectedWeather(null); }}>{formatTime(period.startTime)}</button>)}</div></section>

    <aside className="layer-panel glass-panel" aria-labelledby="layer-title">
      <p className="panel-kicker" id="layer-title">圖層</p>
      <div className="layer-list" role="radiogroup" aria-label="資料圖層">
        {([['temperature', '🌡️', '氣溫'], ['rain', '🌧️', '降雨機率'], ['weather', '🌤️', '天氣'], ['comfort', '💧', '舒適度']] as const).map(([value, icon, label]) => <button key={value} className={`layer-button ${layer === value ? 'active' : ''}`} onClick={() => setLayer(value)} role="radio" aria-checked={layer === value}><span>{icon}</span>{label}</button>)}
      </div>
      <div className="toggle-list">
        <label><input type="checkbox" checked={labelsEnabled} onChange={(event) => setLabelsEnabled(event.target.checked)} /><span>縣市數值標籤</span></label>
        <label><input type="checkbox" checked={tintEnabled} onChange={(event) => setTintEnabled(event.target.checked)} /><span>氣象色彩覆蓋</span></label>
        <label><input type="checkbox" checked={effectsEnabled} onChange={(event) => setEffectsEnabled(event.target.checked)} /><span>動態天氣效果</span></label>
      </div>
      <div className="base-map-control"><p>底圖</p><div><button className={`base-button ${baseMap === 'dark' ? 'active' : ''}`} onClick={() => setBaseMap('dark')}>深色</button><button className={`base-button ${baseMap === 'street' ? 'active' : ''}`} onClick={() => setBaseMap('street')}>街道圖</button></div></div>
      <button className="locate-button" onClick={locate}><span>⌖</span> 定位我的位置</button>
    </aside>

    <section className="legend glass-panel" aria-label="圖例"><strong>{legend.unit}</strong><div><span className="legend-gradient" style={{ background: legend.gradient }} /><div id="legend-values">{legend.values.map((value) => <small key={value}>{value}</small>)}</div></div></section>
    <section className="status-bar glass-panel" aria-live="polite"><span>更新於 <strong>{formatTime(status?.database.syncedAt, true)}</strong></span><button onClick={syncNow} disabled={syncing}>{syncing ? '同步中…' : '↻ 更新整理'}</button></section>
    {notice && <div className="notice" role="status" onClick={() => setNotice('')}>{notice}</div>}
  </main>;
}
