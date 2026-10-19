import { handleAdCode } from '@/lib/landing/ad-codes-server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) { return handleAdCode(request); }
