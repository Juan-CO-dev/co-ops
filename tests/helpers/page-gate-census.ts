/**
 * Nav PR 3: the census pages for the page-gate reader. The entry request of each destination comes from the list
 * (its route, and `?location=S` when it takes a shop); what the page ADMITS is read from the page itself.
 */
import { DESTINATIONS } from "@/lib/nav/destinations";
import { LAYOUT_FILE, PULSE_HOME_FILE, Reader, type CensusPage, type ReaderOptions } from "./page-gate";
import { pageFiles } from "./nav-pages";

const PAGES = pageFiles();

export function destinationPages(): CensusPage[] {
  return DESTINATIONS.map((d) => {
    const file = PAGES.get(d.route);
    if (!file) throw new Error(`no page for ${d.route}`);
    return { route: d.route, file, takesShop: d.takesShop, admin: file.startsWith("app/admin/") };
  });
}

/** The 86 census files: the 84 destination pages, the admin layout and PulseHome. */
export function censusFiles(): string[] {
  return [...destinationPages().map((p) => p.file), LAYOUT_FILE, PULSE_HOME_FILE];
}

export function newReader(opts: ReaderOptions = {}): Reader {
  return new Reader(destinationPages(), new Set(PAGES.keys()), opts);
}
