/**
 * PlaceholderCard — rendered by every module page that hasn't been built yet.
 *
 * Pattern from prototype's `PH` component. Shows the module title, a
 * description, and a feature list so the user (and future Cristian) can see
 * what's coming. Replaced module-by-module as features ship.
 */

interface PlaceholderCardProps {
  title: string;
  description: string;
  features: string[];
  /** "Phase B" by default; some modules will land in Phase C+. */
  shippingIn?: string;
}

export function PlaceholderCard({
  title,
  description,
  features,
  shippingIn = "Phase B",
}: PlaceholderCardProps) {
  return (
    <div className="mx-auto w-full max-w-[460px] p-3 pb-8">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="m-0 text-base font-bold text-white">{title}</h2>
      </div>
      <div className="rounded-lg border border-co-gold bg-co-surface p-5 text-center">
        <h3 className="m-0 mb-1.5 text-sm font-bold text-co-gold">
          Coming in {shippingIn}
        </h3>
        <p className="m-0 mb-3 text-[11px] text-co-text-muted">
          {description}
        </p>
        <ul className="m-0 list-none p-0 text-left">
          {features.map((f, i) => (
            <li
              key={i}
              className="my-1 border-l-2 border-co-gold pl-2 text-[10px] text-[#aaa]"
            >
              {f}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
