import { handleMcp } from "@/server/mcp/servers.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Context = { params: Promise<{ server: string }> };

async function route(request: Request, { params }: Context) {
  const { server } = await params;
  return handleMcp(request, server);
}
export { route as GET, route as POST, route as DELETE };
