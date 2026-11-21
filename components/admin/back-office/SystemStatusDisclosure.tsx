"use client";

/**
 * System status on the Back office (nav PR 4 plan r2, 1.4 with amendment A2). A collapsed CollapsibleSection that
 * opens itself when the person ASKS for it:
 *  - the page loads with `#system-status` (a fix link followed from elsewhere), or the hash changes to it;
 *  - a fix link on this page is tapped (SystemStatusLink), every time, including a second tap with the same hash,
 *    which fires no `hashchange`: the link announces `co:open-system-status` and the panel opens and scrolls into view.
 * It reads the fragment, writes nothing and stores nothing (Disclosure Doctrine D9): open or closed lasts for the visit.
 */
import { useEffect, useState, type ReactNode } from "react";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";

export const SYSTEM_STATUS_ID = "system-status";
export const OPEN_SYSTEM_STATUS_EVENT = "co:open-system-status";

export function SystemStatusDisclosure({ title, description, count, badge, children }: {
  title: string; description?: string; count?: ReactNode; badge?: ReactNode; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const fromHash = () => { if (window.location.hash === `#${SYSTEM_STATUS_ID}`) setOpen(true); };
    const onAsk = () => setOpen(true);
    fromHash();
    window.addEventListener("hashchange", fromHash);
    window.addEventListener(OPEN_SYSTEM_STATUS_EVENT, onAsk);
    return () => {
      window.removeEventListener("hashchange", fromHash);
      window.removeEventListener(OPEN_SYSTEM_STATUS_EVENT, onAsk);
    };
  }, []);
  return (
    <div id={SYSTEM_STATUS_ID} className="scroll-mt-4">
      <CollapsibleSection idBase={`${SYSTEM_STATUS_ID}-panel`} title={title} description={description} count={count} badge={badge}
        open={open} onToggle={() => setOpen((v) => !v)}>
        {children}
      </CollapsibleSection>
    </div>
  );
}

/** A fix link to System status: a real `#system-status` link that also opens the panel on every tap. */
export function SystemStatusLink({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <a href={`#${SYSTEM_STATUS_ID}`} className={className} onClick={() => {
      window.dispatchEvent(new Event(OPEN_SYSTEM_STATUS_EVENT));
      // After React opens the panel, bring it into view (a same-hash tap does not scroll on its own everywhere).
      window.requestAnimationFrame(() => document.getElementById(SYSTEM_STATUS_ID)?.scrollIntoView?.({ block: "start" }));
    }}>
      {children}
    </a>
  );
}
