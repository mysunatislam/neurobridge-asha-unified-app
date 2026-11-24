import handler from "@/server/handlers/workflow.js";
import { toRouteHandler } from "@/server/node-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const route = toRouteHandler(handler);
export { route as POST };
