import { ok, readJson, route } from "@/lib/api";
import { assertSameOrigin, requireSession } from "@/lib/auth/session";
import { createEvent, listPublicEvents, type ListFilter } from "@/lib/services/events";

export const GET = route(async (req) => {
  const sp = new URL(req.url).searchParams;
  const filter = (["upcoming", "week", "past"] as const).find((f) => f === sp.get("filter")) as ListFilter | undefined;
  const rows = await listPublicEvents({ q: sp.get("q") ?? undefined, tag: sp.get("tag") ?? undefined, filter });
  return ok(
    rows.map((r) => ({
      id: r.event.id,
      slug: r.event.slug,
      title: r.event.title,
      summary: r.event.summary,
      location: r.event.location,
      startAt: r.event.startAt,
      endAt: r.event.endAt,
      timezone: r.event.timezone,
      isAllDay: r.event.isAllDay,
      tags: r.event.tags,
      status: r.event.status,
      capacity: r.event.capacity,
      confirmed: r.confirmed,
    })),
  );
});

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const s = await requireSession(req);
  const { event, template } = await createEvent(s, await readJson(req));
  return ok({ id: event.id, slug: event.slug, status: event.status, template }, 201);
});
