"use client";

import { ChevronDown, Eye, ImagePlus, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FieldError, Hint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError, withSignature } from "@/lib/client/api";
import { SignerRejected } from "@/lib/client/signer";
import { useT } from "@/lib/i18n/client";
import { COMMON_TIMEZONES, formatEventDate } from "@/lib/time";
import { eventFormSchema, toRange } from "@/lib/validation";

export type EventFormValues = {
  title: string;
  summary: string;
  description: string;
  imageUrl: string;
  location: string;
  hashtags: string[];
  isAllDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  timezone: string;
  capacity: number | null;
  approvalMode: "auto" | "manual";
  allowGuest: boolean;
  visibility: "public_nostr" | "unlisted_db";
};

function defaults(): EventFormValues {
  const d = new Date(Date.now() + 7 * 86400 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return {
    title: "",
    summary: "",
    description: "",
    imageUrl: "",
    location: "",
    hashtags: [],
    isAllDay: false,
    startDate: date,
    startTime: "19:00",
    endDate: date,
    endTime: "21:00",
    timezone: "Asia/Tokyo",
    capacity: null,
    approvalMode: "auto",
    allowGuest: true,
    visibility: "public_nostr",
  };
}

type Mode = { kind: "create" } | { kind: "edit"; id: string; status: string };

export function EventForm({ mode, initial }: { mode: Mode; initial?: EventFormValues }) {
  const { t, locale } = useT();
  const { user, login, sign } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const [v, setV] = useState<EventFormValues>(initial ?? defaults());
  const [tagsText, setTagsText] = useState((initial?.hashtags ?? []).join(" "));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<null | "save" | "sign">(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(!!(initial?.description || initial?.imageUrl || initial?.summary));
  const [preview, setPreview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const isEdit = mode.kind === "edit";

  const set = <K extends keyof EventFormValues>(k: K, val: EventFormValues[K]) => {
    setV((prev) => {
      const next = { ...prev, [k]: val };
      // 開始日を変えたら、同日だった終了日も追従
      if (k === "startDate" && prev.endDate === prev.startDate) next.endDate = val as string;
      return next;
    });
    if (errors[k as string]) setErrors((e) => ({ ...e, [k as string]: "" }));
  };

  const payload = useMemo(
    () => ({
      ...v,
      hashtags: tagsText
        .split(/[\s,、#]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
      summary: v.summary || null,
      imageUrl: v.imageUrl || null,
      location: v.location || null,
    }),
    [v, tagsText],
  );

  const parsed = eventFormSchema.safeParse(payload);
  const range = parsed.success ? toRange(parsed.data) : null;

  function validate(): boolean {
    const r = eventFormSchema.safeParse(payload);
    if (r.success) {
      setErrors({});
      return true;
    }
    const errs: Record<string, string> = {};
    for (const i of r.error.issues) {
      const k = String(i.path[0] ?? "form");
      if (!errs[k]) errs[k] = i.message;
    }
    setErrors(errs);
    document.getElementById(`f-${Object.keys(errs)[0]}`)?.focus();
    return false;
  }

  async function upload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/uploads", { method: "POST", body: fd, credentials: "same-origin" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? t.common.unknownError);
      set("imageUrl", json.data.url);
    } catch (e) {
      toast({ tone: "danger", text: e instanceof Error ? e.message : t.common.unknownError });
    } finally {
      setUploading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!validate()) return;
    if (!user && !(await login())) return;

    if (mode.kind === "edit") {
      setBusy("save");
      try {
        await withSignature(
          (signedEvent) => api(`/api/events/${mode.id}`, { method: "PATCH", body: { event: payload, signedEvent } }),
          async (tpl) => {
            setBusy("sign");
            return sign(tpl);
          },
        );
        toast({ tone: "ok", text: t.form.saved });
        router.push(`/dashboard/events/${mode.id}`);
        router.refresh();
      } catch (err) {
        handleError(err);
      } finally {
        setBusy(null);
      }
      return;
    }

    setBusy("save");
    let created: { id: string; slug: string; template: unknown } | null = null;
    try {
      created = await api<{ id: string; slug: string; template: unknown }>("/api/events", { body: payload });
      if (v.visibility === "public_nostr") {
        setBusy("sign");
        await withSignature(
          (signedEvent) => api(`/api/events/${created!.id}/publish`, { body: { signedEvent } }),
          (tpl) => sign(tpl),
        );
        toast({ tone: "ok", text: t.form.published });
      } else {
        toast({ tone: "ok", text: t.form.published });
      }
      router.push(`/dashboard/events/${created.id}?created=1`);
      router.refresh();
    } catch (err) {
      if (created) {
        // 署名キャンセル・失敗でもドラフトは保存済み。管理画面から再試行できる
        toast({ tone: "info", text: t.form.signCancelled });
        router.push(`/dashboard/events/${created.id}`);
        return;
      }
      handleError(err);
    } finally {
      setBusy(null);
    }
  }

  function handleError(err: unknown) {
    if (err instanceof SignerRejected) {
      setFormError(t.form.signCancelled);
    } else if (err instanceof ApiClientError) {
      if (err.code === "invalid_input" && Array.isArray(err.details)) {
        const errs: Record<string, string> = {};
        for (const d of err.details as { path: (string | number)[]; message: string }[]) errs[String(d.path[0])] = d.message;
        setErrors(errs);
      }
      setFormError(err.message);
    } else {
      setFormError(err instanceof Error ? err.message : t.common.unknownError);
    }
  }

  const err = (k: string) => errors[k] || undefined;
  const aria = (k: string) => ({ "aria-invalid": !!errors[k] || undefined, "aria-describedby": errors[k] ? `e-${k}` : undefined });
  const publishedPublic = isEdit && v.visibility === "public_nostr" && mode.status !== "draft";

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      {!user && <Alert tone="info" title={t.form.loginRequired} />}
      <Card>
        <CardContent className="space-y-5 pt-5">
          <div>
            <Label htmlFor="f-title">{t.form.title}</Label>
            <Input
              id="f-title"
              value={v.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder={t.form.titlePlaceholder}
              maxLength={120}
              required
              autoFocus={!isEdit}
              {...aria("title")}
            />
            <FieldError id="e-title">{err("title")}</FieldError>
          </div>

          <div className="space-y-3">
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                className="h-5 w-5 accent-[var(--primary)]"
                checked={v.isAllDay}
                onChange={(e) => set("isAllDay", e.target.checked)}
                disabled={publishedPublic}
              />
              {t.form.allDay}
            </label>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="col-span-2 sm:col-span-2">
                <Label htmlFor="f-startDate">{t.form.date}</Label>
                <Input id="f-startDate" type="date" value={v.startDate} onChange={(e) => set("startDate", e.target.value)} {...aria("startDate")} />
              </div>
              {v.isAllDay ? (
                <div className="col-span-2">
                  <Label htmlFor="f-endDate">{t.form.endDate}</Label>
                  <Input id="f-endDate" type="date" value={v.endDate} min={v.startDate} onChange={(e) => set("endDate", e.target.value)} {...aria("endDate")} />
                </div>
              ) : (
                <>
                  <div>
                    <Label htmlFor="f-startTime">{t.form.start}</Label>
                    <Input id="f-startTime" type="time" value={v.startTime} onChange={(e) => set("startTime", e.target.value)} {...aria("startTime")} />
                  </div>
                  <div>
                    <Label htmlFor="f-endTime">{t.form.end}</Label>
                    <Input id="f-endTime" type="time" value={v.endTime} onChange={(e) => set("endTime", e.target.value)} {...aria("endTime")} />
                  </div>
                </>
              )}
            </div>
            {!v.isAllDay && (
              <details className="text-sm" open={v.endDate !== v.startDate}>
                <summary className="cursor-pointer text-muted">{t.form.endDate}</summary>
                <Input
                  id="f-endDate"
                  type="date"
                  className="mt-2 max-w-60"
                  value={v.endDate}
                  min={v.startDate}
                  onChange={(e) => set("endDate", e.target.value)}
                  aria-label={t.form.endDate}
                />
              </details>
            )}
            <FieldError id="e-endTime">{err("endTime") ?? err("endDate") ?? err("startDate") ?? err("startTime")}</FieldError>
            {range && (
              <p className="text-sm text-muted" aria-live="polite">
                {formatEventDate(range.startAt, range.endAt, v.timezone, v.isAllDay, locale)}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="f-location">{t.form.location}</Label>
            <Input
              id="f-location"
              value={v.location}
              onChange={(e) => set("location", e.target.value)}
              placeholder={t.form.locationPlaceholder}
              maxLength={300}
              {...aria("location")}
            />
            <FieldError id="e-location">{err("location")}</FieldError>
          </div>

          {!showMore ? (
            <button type="button" onClick={() => setShowMore(true)} className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline">
              <Plus className="h-4 w-4" aria-hidden /> {t.form.moreContent}
            </button>
          ) : (
            <div className="space-y-5 border-t border-border pt-5">
              <div>
                <Label htmlFor="f-summary">{t.form.summary}</Label>
                <Input id="f-summary" value={v.summary} maxLength={280} onChange={(e) => set("summary", e.target.value)} {...aria("summary")} />
              </div>
              <div>
                <Label htmlFor="f-description">{t.form.description}</Label>
                <Textarea id="f-description" rows={6} value={v.description} maxLength={20000} onChange={(e) => set("description", e.target.value)} />
              </div>
              <div>
                <Label>{t.form.image}</Label>
                {v.imageUrl ? (
                  <div className="flex items-start gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={v.imageUrl} alt="" className="h-28 w-44 rounded-xl border border-border object-cover" referrerPolicy="no-referrer" />
                    <Button type="button" variant="outline" size="sm" onClick={() => set("imageUrl", "")}>
                      <Trash2 className="h-4 w-4" aria-hidden /> {t.form.imageRemove}
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      className="hidden"
                      onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
                    />
                    <Button type="button" variant="outline" loading={uploading} onClick={() => (user ? fileRef.current?.click() : login())}>
                      <ImagePlus className="h-4 w-4" aria-hidden /> {t.form.imageUpload}
                    </Button>
                    <Input
                      id="f-imageUrl"
                      className="max-w-sm flex-1"
                      placeholder={`${t.form.imageUrl} (https://…)`}
                      aria-label={t.form.imageUrl}
                      onBlur={(e) => e.target.value && set("imageUrl", e.target.value.trim())}
                      {...aria("imageUrl")}
                    />
                  </div>
                )}
                <FieldError id="e-imageUrl">{err("imageUrl")}</FieldError>
              </div>
              <div>
                <Label htmlFor="f-tags">{t.form.tags}</Label>
                <Input id="f-tags" value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="meetup bitcoin" {...aria("hashtags")} />
                <FieldError id="e-hashtags">{err("hashtags")}</FieldError>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <details className="group rounded-2xl border border-border bg-surface" open={isEdit || undefined}>
        <summary className="flex cursor-pointer list-none items-center justify-between p-5 font-bold">
          {t.form.advanced}
          <ChevronDown className="h-5 w-5 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="space-y-5 px-5 pb-5">
          <div>
            <Label htmlFor="f-capacity">{t.form.capacity}</Label>
            <Input
              id="f-capacity"
              type="number"
              inputMode="numeric"
              min={1}
              className="max-w-40"
              value={v.capacity ?? ""}
              onChange={(e) => set("capacity", e.target.value === "" ? null : Math.max(1, Math.floor(Number(e.target.value))))}
              placeholder={t.common.unlimited}
              {...aria("capacity")}
            />
            <Hint>{t.form.capacityHint}</Hint>
            <FieldError id="e-capacity">{err("capacity")}</FieldError>
          </div>
          <fieldset>
            <legend className="mb-1.5 text-sm font-semibold">{t.form.approval}</legend>
            <div className="flex flex-col gap-2 sm:flex-row sm:gap-5">
              {(["auto", "manual"] as const).map((m) => (
                <label key={m} className="inline-flex cursor-pointer items-center gap-2">
                  <input type="radio" name="approval" className="h-5 w-5 accent-[var(--primary)]" checked={v.approvalMode === m} onChange={() => set("approvalMode", m)} />
                  {m === "auto" ? t.form.approvalAuto : t.form.approvalManual}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex cursor-pointer items-start gap-2">
            <input type="checkbox" className="mt-1 h-5 w-5 accent-[var(--primary)]" checked={v.allowGuest} onChange={(e) => set("allowGuest", e.target.checked)} />
            {t.form.allowGuest}
          </label>
          <fieldset disabled={isEdit}>
            <legend className="mb-1.5 text-sm font-semibold">{t.form.visibility}</legend>
            <div className="flex flex-col gap-2">
              {(["public_nostr", "unlisted_db"] as const).map((m) => (
                <label key={m} className="inline-flex cursor-pointer items-center gap-2">
                  <input type="radio" name="visibility" className="h-5 w-5 accent-[var(--primary)]" checked={v.visibility === m} onChange={() => set("visibility", m)} />
                  {m === "public_nostr" ? t.form.visibilityPublic : t.form.visibilityUnlisted}
                </label>
              ))}
            </div>
            {isEdit && <Hint>{t.form.visibilityLocked}</Hint>}
            {v.visibility === "unlisted_db" && <Hint>{t.form.unlistedNote}</Hint>}
          </fieldset>
          <div>
            <Label htmlFor="f-timezone">{t.form.timezone}</Label>
            <Select id="f-timezone" className="max-w-72" value={v.timezone} onChange={(e) => set("timezone", e.target.value)}>
              {[...new Set([v.timezone, ...COMMON_TIMEZONES])].map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </details>

      {preview && parsed.success && range && (
        <Card className="overflow-hidden" aria-label={t.form.preview}>
          {v.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={v.imageUrl} alt="" className="h-48 w-full object-cover" referrerPolicy="no-referrer" />
          )}
          <CardContent className="space-y-2 pt-5">
            <h2 className="text-2xl font-extrabold">{v.title}</h2>
            {v.summary && <p className="text-muted">{v.summary}</p>}
            <p className="font-semibold">{formatEventDate(range.startAt, range.endAt, v.timezone, v.isAllDay, locale)}</p>
            {v.location && <p>{v.location}</p>}
            {v.description && <p className="prose-text text-sm">{v.description}</p>}
          </CardContent>
        </Card>
      )}

      {v.visibility === "public_nostr" && !publishedPublic && <Alert tone="info">{t.form.publicNotice}</Alert>}
      {formError && <Alert tone="danger" title={formError} />}
      {busy === "sign" && <Alert tone="info" title={t.form.signing} />}

      <div className="sticky bottom-20 z-10 flex gap-3 rounded-2xl border border-border bg-surface/95 p-3 backdrop-blur sm:bottom-4">
        <Button type="button" variant="outline" className="flex-1 sm:flex-none" onClick={() => (validate() ? setPreview((p) => !p) : null)}>
          <Eye className="h-4 w-4" aria-hidden /> {preview ? t.form.hidePreview : t.form.preview}
        </Button>
        <Button type="submit" size="lg" className="flex-[2] sm:ml-auto sm:flex-none" loading={busy !== null}>
          {isEdit ? t.form.saveChanges : `${t.form.publish} →`}
        </Button>
      </div>
    </form>
  );
}
