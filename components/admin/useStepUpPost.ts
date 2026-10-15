"use client";

/**
 * useStepUpPost — postJson for a step-up-gated write, with the one extra duty the Tier E
 * window needs: when the server refuses with step_up_required / step_up_stale, tell
 * StepUpProvider to forget its unlock so the NEXT tap prompts (catalog Phase 1, 2026-10-15).
 */
import { useCallback } from "react";

import { useStepUp } from "@/components/admin/StepUpProvider";
import { postJson, type PostResult } from "@/components/admin/vendors/shared";
import { isStepUpRefusal } from "@/lib/admin/step-up-shared";

type Method = "POST" | "PUT" | "PATCH" | "DELETE";

export function useStepUpPost(): (url: string, body: unknown, method?: Method) => Promise<PostResult> {
  const { forgetStepUp } = useStepUp();
  return useCallback(
    async (url: string, body: unknown, method: Method = "POST"): Promise<PostResult> => {
      const result = await postJson(url, body, method);
      if (!result.ok && isStepUpRefusal(result.code)) forgetStepUp();
      return result;
    },
    [forgetStepUp],
  );
}
