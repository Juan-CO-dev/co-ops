"use client";

/**
 * AM prep collapse context (Wave 1 B). AmPrepForm provides it; PrepSection (the one
 * wrapper every prep section renders through) reads it. Threading via context keeps
 * the three section components (Generic / Misc / Mixed) untouched so branch A's
 * edits to them rebase cleanly. Absent provider = the old always-open section.
 */

import { createContext } from "react";

export interface AmPrepCollapse {
  formKey: string;
  isOpen: (section: string) => boolean;
  toggle: (section: string) => void;
  /** Per section slug: rows done / rows total, under validateRawValues' own rule. */
  progress: Record<string, { done: number; total: number }>;
}

export const AmPrepCollapseContext = createContext<AmPrepCollapse | null>(null);
