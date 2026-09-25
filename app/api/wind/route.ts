import { getWindField } from '@/lib/model-wind';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return Response.json(await getWindField(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
