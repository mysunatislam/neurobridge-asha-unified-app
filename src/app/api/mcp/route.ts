import { mcpIndex } from "@/server/mcp/servers.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return Response.json(mcpIndex(new URL(request.url).origin), {
    headers: { "Cache-Control": "no-store" },
  });
}
