import WeatherConsole from '@/components/WeatherConsole';
import { getStatus, getWeather } from '@/lib/weather-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  let props: React.ComponentProps<typeof WeatherConsole>;
  try {
    const initialWeather = await getWeather();
    const initialStatus = await getStatus();
    props = { initialWeather, initialStatus };
  } catch (error) {
    props = {
      initialWeather: { locations: [], count: 0 },
      initialStatus: null,
      initialError: error instanceof Error ? error.message : String(error),
    };
  }
  return <WeatherConsole {...props} />;
}
