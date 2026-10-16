"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import { jobErrorKey } from "@/lib/catalog/jobs-shared";
import type { TranslationKey } from "@/lib/i18n/types";
import type { ToastLinkChoices } from "@/lib/catalog/jobs-shared";
type Props = {
    menuItemId: string;
    shopId: string;
    initial?: ToastLinkChoices;
};
/** Changing identity remounts every draft and invalidates the previous read/write answers. */
export function ToastLinkSection(props: Props) {
    return <ToastLinkBody key={`${props.menuItemId}:${props.shopId}`} {...props}/>;
}
function ToastLinkBody({ menuItemId, shopId, initial }: Props) {
    const { t } = useTranslation();
    const { requestStepUp } = useStepUp();
    const post = useStepUpPost();
    const validInitial = initial?.menuItemId === menuItemId && initial.shopId === shopId ? initial : undefined;
    const [view, setView] = useState<ToastLinkChoices | null>(validInitial ?? null);
    const [selected, setSelected] = useState(validInitial?.suggestion?.guid ?? '');
    const [search, setSearch] = useState('');
    const [confirmed, setConfirmed] = useState(false);
    const [busy, setBusy] = useState(!validInitial);
    const [needsRefresh, setNeedsRefresh] = useState(false);
    const seeded = useRef(Boolean(validInitial));
    const [error, setError] = useState<TranslationKey | null>(null);
    const alive = useRef(true), generation = useRef(0), pending = useRef(false);
    const url = `/api/admin/catalog/menu-item/${encodeURIComponent(menuItemId)}/toast`;
    const refresh = useCallback(async () => {
        const version = ++generation.current;
        setBusy(true);
        setError(null);
        setConfirmed(false);
        try {
            const response = await fetch(`${url}?location=${encodeURIComponent(shopId)}`, { cache: 'no-store' });
            if (!response.ok)
                throw new Error('read');
            const next: ToastLinkChoices = await response.json();
            if (next.menuItemId !== menuItemId || next.shopId !== shopId || !Array.isArray(next.choices) || !Array.isArray(next.linked))
                throw new Error('shape');
            if (alive.current && version === generation.current) {
                setView(next);
                setSelected(next.suggestion?.guid ?? '');
                setNeedsRefresh(false);
            }
        }
        catch {
            if (alive.current && version === generation.current) {
                setError("catalog.jobs.toast.load_error");
                setView(null);
            }
        }
        finally {
            if (alive.current && version === generation.current)
                setBusy(false);
        }
    }, [url, shopId, menuItemId]);
    useEffect(() => {
        alive.current = true;
        let cancelled = false;
        if (!seeded.current)
            queueMicrotask(() => { if (!cancelled) void refresh(); });
        return () => { cancelled = true; alive.current = false; };
    }, [refresh]); // Initial props seed only this identity's mount.
    async function save() {
        if (pending.current || busy || needsRefresh || !confirmed || !selected || !view?.choices.some(c => c.guid === selected))
            return;
        pending.current = true;
        setBusy(true);
        setError(null);
        const version = generation.current;
        try {
            if (await requestStepUp("A") !== 'ok')
                return;
            if (!alive.current || version !== generation.current)
                return;
            const result = await post(url, { locationId: shopId, toastItemGuid: selected, confirmed: true });
            if (!alive.current || version !== generation.current)
                return;
            if (!result.ok) {
                setNeedsRefresh(true);
                setConfirmed(false);
                setError(result.code === "generic" ? "catalog.jobs.toast.save_error" : jobErrorKey(result.code));
                return;
            }
            await refresh();
        }
        catch {
            if (alive.current && version === generation.current) {
                setNeedsRefresh(true);
                setConfirmed(false);
                setError("catalog.jobs.toast.save_error");
            }
        }
        finally {
            pending.current = false;
            if (alive.current)
                setBusy(false);
        }
    }
    const choices = (view?.choices ?? []).filter(c => c.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
    const control = 'min-h-[44px] w-full min-w-0 rounded border px-3';
    return <section className="min-w-0 space-y-3" aria-label={t('catalog.jobs.toast.title')} aria-busy={busy}>
    <h2 className="font-semibold">{t('catalog.jobs.toast.title')}</h2>
    {busy && <p role="status">{t('catalog.jobs.toast.loading')}</p>}
    {error && <p role="alert">{t(error!)}</p>}
    {view?.status === 'unavailable' && <p>{t('catalog.jobs.toast.unavailable')}</p>}
    {view?.status === 'empty' && <p>{t('catalog.jobs.toast.empty')}</p>}
    {!!view?.linked.length && <div><p>{t('catalog.jobs.toast.linked')}</p><ul>{view.linked.map(c => <li key={c.guid} className="break-words">{c.name}</li>)}</ul></div>}
    {view?.suggestion && <p>{t('catalog.jobs.toast.suggested', { name: view.suggestion.name })}</p>}
    {!!view?.choices.length && <fieldset disabled={busy} className="min-w-0 space-y-3">
      <label className="block">{t('catalog.jobs.toast.search')}<input className={control} value={search} onChange={e => { setSearch(e.target.value); setConfirmed(false); setSelected(''); }} type="search" aria-label={t('catalog.jobs.toast.search_aria')}/></label>
      <label className="block">{t('catalog.jobs.toast.choices')}<select aria-label={t("catalog.jobs.toast.choices")} className={control} value={selected} onChange={e => { setSelected(e.target.value); setConfirmed(false); }}><option value="">{t('catalog.jobs.toast.select')}</option>{choices.map(c => <option key={c.guid} value={c.guid}>{c.name}</option>)}</select></label>
      <label className="flex min-h-[44px] items-center gap-2"><input aria-label={t("catalog.jobs.toast.confirmation")} type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/>{t('catalog.jobs.toast.confirmation')}</label>
      <button type="button" className={`${control} flex items-center justify-center`} disabled={busy || needsRefresh || !confirmed || !selected} onClick={() => void save()}>{t('catalog.jobs.toast.confirm')}</button>
    </fieldset>}
    <button type="button" className={`${control} flex items-center justify-center`} disabled={busy} onClick={() => void refresh()}>{t('catalog.jobs.toast.refresh')}</button>
  </section>;
}
