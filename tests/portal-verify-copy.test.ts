// Build 2, A2: /order/verify speaks the Meta form's language and names the link's lifetime.
import { expect, it } from "vitest";
import { parseVerifyParams, verifyCopy } from "@/lib/portal/verify-copy-shared";

it("a Meta continuation link carries lang=es and ttl=72h", () => {
  expect(parseVerifyParams("?token=abc&lang=es&ttl=72h")).toEqual({ token: "abc", language: "es", ttlLabel: "72 horas" });
  expect(parseVerifyParams("?token=abc&ttl=72h")).toEqual({ token: "abc", language: "en", ttlLabel: "72 hours" });
  expect(parseVerifyParams("?token=abc&ttl=1h&lang=es")).toEqual({ token: "abc", language: "es", ttlLabel: "1 hora" });
});
it("the token: absent and EMPTY are both missing (review P3-4); a value is kept verbatim", () => {
  expect(parseVerifyParams("").token).toBeNull();
  expect(parseVerifyParams("?lang=es").token).toBeNull();
  expect(parseVerifyParams("?token=").token).toBeNull();
  expect(parseVerifyParams("?token=&lang=es").token).toBeNull();
  expect(parseVerifyParams("?token=abc.def-123").token).toBe("abc.def-123");
});
it("a plain portal link keeps today's 30 minutes in English; garbage is ignored", () => {
  expect(parseVerifyParams("?token=abc")).toEqual({ token: "abc", language: "en", ttlLabel: "30 minutes" });
  expect(parseVerifyParams("?token=abc&lang=fr&ttl=<script>")).toEqual({ token: "abc", language: "en", ttlLabel: "30 minutes" });
  expect(parseVerifyParams("?lang=es")).toEqual({ token: null, language: "es", ttlLabel: "30 minutos" });
});
it("the expired page says the lifetime in the right language", () => {
  expect(verifyCopy("es", "72 horas").expiredBody).toContain("caducan a las 72 horas");
  expect(verifyCopy("es", "72 horas").expiredTitle).toBe("Enlace caducado");
  expect(verifyCopy("en", "30 minutes").expiredBody).toBe("This link has expired, was already used, or was replaced by a newer one. Only your most recent link works, and links expire after 30 minutes.");
  expect(verifyCopy("en", "72 hours").expiredBody).toContain("expire after 72 hours");
});
