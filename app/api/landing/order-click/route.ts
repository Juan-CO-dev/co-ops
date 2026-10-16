import { handleOrderClick } from "@/lib/landing/order-click-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return handleOrderClick(request); }
