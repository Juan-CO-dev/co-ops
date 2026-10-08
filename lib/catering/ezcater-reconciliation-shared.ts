/** Safe review projection; never includes provider payloads or customer contacts. */
export interface EzcaterReconciliationDetail {
  available: boolean;
  locationConflict: boolean;
  reviews: Array<{ id: string; source: "ezcater" | "toast"; code: string; candidateCount: number }>;
  linkCount: number;
  shadowRows: number;
  truncated: boolean;
}
