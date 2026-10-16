import { handleMetaEvent } from "@/lib/landing/meta-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return handleMetaEvent(request); }
