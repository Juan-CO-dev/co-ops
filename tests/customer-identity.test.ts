/** 0234 identity rules: normalisation, masked relay emails, cards (never a PAN), name + card is only a suggestion. */
import { describe, expect, it } from "vitest";
import {
  SUGGESTION_MIN_CONFIDENCE, cardBrand, cardLast4, classifyEmail, likelySamePerson, nameKey, normalizeEmail, normalizePhoneE164,
} from "@/lib/customers/identity-shared";

describe("normalisation", () => {
  it("lowercases and trims email; refuses non-addresses", () => {
    expect(normalizeEmail("  Ana.Diaz@Example.COM ")).toBe("ana.diaz@example.com");
    expect(normalizeEmail("not an email")).toBeNull();
    expect(normalizeEmail(42)).toBeNull();
  });
  it("phones become E.164; bare US numbers get +1; garbage is refused, never guessed", () => {
    expect(normalizePhoneE164("(202) 555-0101")).toBe("+12025550101");
    expect(normalizePhoneE164("1-202-555-0101")).toBe("+12025550101");
    expect(normalizePhoneE164("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhoneE164("202-555-0101 ext 12")).toBe("+12025550101");
    expect(normalizePhoneE164("555-0101")).toBeNull();
    expect(normalizePhoneE164("123")).toBeNull();
  });
  it("name keys compare one spelling", () => {
    expect(nameKey("  José   DÍAZ ")).toBe("jose diaz");
    expect(nameKey("A")).toBeNull();
  });
});

describe("masked relay emails are never real", () => {
  it.each(["abc123@doordash.com", "guest@relay.toasttab.com", "x7@marketplace.amazon.com", "order-1@ubereats.com", "relay+1@example.com", "a@relay.example.com"])(
    "%s is masked", (e) => expect(classifyEmail(e).kind).toBe("masked"));
  it.each(["noemail@gmail.com", "none@none.com", "n/a@example.com"])("%s is a placeholder", (e) => expect(classifyEmail(e).kind).toBe("placeholder"));
  it("a normal address is ok and normalised", () => expect(classifyEmail(" Bo@Example.com")).toEqual({ kind: "ok", email: "bo@example.com" }));
});

describe("cards: brand + last four only", () => {
  it("maps Toast card types to the closed brand list", () => {
    expect(cardBrand("VISA")).toBe("VISA");
    expect(cardBrand("MASTERCARD")).toBe("MASTERCARD");
    expect(cardBrand("AMEX")).toBe("AMEX");
    expect(cardBrand("CUP")).toBe("UNIONPAY");
    expect(cardBrand("SOMETHINGELSE")).toBe("OTHER");
    expect(cardBrand("")).toBeNull();
  });
  it("a full card number is refused, never truncated into last4", () => {
    expect(cardLast4("4242")).toBe("4242");
    expect(cardLast4("4242424242424242")).toBeNull();
    expect(cardLast4("424")).toBeNull();
  });
});

describe("likely same person (suggestion only, never a merge)", () => {
  it("a name alone is never evidence", () => {
    expect(likelySamePerson({ nameA: "Juan Perez", nameB: "Juan Perez", sharedCards: 0, sameShop: true })).toBeNull();
  });
  it("a card alone with different names is not a suggestion", () => {
    expect(likelySamePerson({ nameA: "Ana Diaz", nameB: "Bo Li", sharedCards: 1, sameShop: true })).toBeNull();
  });
  it("same full name + shared card = 0.85, same shop adds 0.05", () => {
    expect(likelySamePerson({ nameA: "Ana Diaz", nameB: "ana  diaz", sharedCards: 1, sameShop: false })).toEqual({ confidence: 0.85, reasons: ["same_full_name", "shared_card"] });
    expect(likelySamePerson({ nameA: "Ana Diaz", nameB: "Ana Diaz", sharedCards: 1, sameShop: true })?.confidence).toBe(0.9);
  });
  it("first initial + last name + card is a weaker suggestion at the floor", () => {
    const r = likelySamePerson({ nameA: "Ana Diaz", nameB: "Anabel Diaz", sharedCards: 2, sameShop: false });
    expect(r).toEqual({ confidence: 0.7, reasons: ["similar_name", "shared_card"] });
    expect(r!.confidence).toBeGreaterThanOrEqual(SUGGESTION_MIN_CONFIDENCE);
  });
  it("a single-word name never matches as a full name", () => {
    expect(likelySamePerson({ nameA: "Ana", nameB: "Ana", sharedCards: 1, sameShop: true })).toBeNull();
  });
  it("the module exports no merge function at all", async () => {
    const mod = await import("@/lib/customers/identity-shared");
    expect(Object.keys(mod).filter((k) => /merge/i.test(k))).toEqual([]);
  });
});
