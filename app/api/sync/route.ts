import { syncWeather } from '@/lib/weather-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    return Response.json(await syncWeather(false));
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
