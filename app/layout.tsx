import type { Metadata, Viewport } from 'next';
import 'leaflet/dist/leaflet.css';
import './globals.css';

export const metadata: Metadata = {
  title: '台灣天氣圖台｜CWA 開放資料',
  description: '中央氣象署今明 36 小時縣市天氣預報地圖',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#111827' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-Hant"><body>{children}</body></html>;
}
