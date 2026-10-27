export type IdCtx = { params: Promise<{ id: string }> };

export async function idParam(ctx: IdCtx): Promise<string> {
  const { id } = await ctx.params;
  return id;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}
