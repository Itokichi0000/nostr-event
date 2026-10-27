import { errors, route } from "@/lib/api";
import { config } from "@/lib/config";
import { buildIcs } from "@/lib/ics";
import { getEventBySlug, isPubliclyVisible } from "@/lib/services/events";

export const GET = route<{ params: Promise<{ slug: string }> }>(async (_req, ctx) => {
  const { slug } = await ctx.params;
  const row = await getEventBySlug(slug);
  if (!row || !isPubliclyVisible(row.event)) throw errors.notFound("イベント");
  const ics = buildIcs(row.event, `${config.appUrl}/events/${row.event.slug}`);
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="event.ics"`,
    },
  });
});
