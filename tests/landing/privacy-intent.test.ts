import { expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
const before = {
  "en": {
    "landing.privacy.meta": "When enabled and accepted, Meta receives page and section views and outbound order or catering clicks. Approved ad attribution and a valid Facebook click identifier may be kept for this session. Meta may use its own browser identifiers. Server measurement may send the same click with its event ID and approved browser identifiers for deduplication. With your permission, server measurement may also send browser information (user agent) to Meta. Our application does not send your IP in server events or collect your name, email or phone here; Meta sees network information such as your IP when its browser Pixel connects. We do not store these browser identifiers or server-event payloads in our database or logs. Meta processes data under its own policies. You can reject or withdraw optional measurement here at any time.",
    "landing.privacy.body": "Ordering happens on the ordering provider's site. This page has no customer form. Optional measurement starts only after you accept and is disabled by Do Not Track or Global Privacy Control. We count approximate order clicks by day, shop and approved ad code, not purchases or unique people. We do not save personal identifiers in that counter.",
    "landing.consent.notice": "With your permission, we count order clicks and, when configured, share visits and clicks with Meta to understand our ads. Ordering works either way."
  },
  "es": {
    "landing.privacy.meta": "Si está habilitado y aceptas, Meta recibe visitas a la página y sus secciones y clics para pedidos o catering. La atribución aprobada del anuncio y un identificador válido de clic de Facebook pueden guardarse durante esta sesión. Meta puede usar sus propios identificadores del navegador. La medición del servidor puede enviar el mismo clic con su identificador de evento e identificadores aprobados del navegador para evitar duplicados. Con tu permiso, la medición del servidor también puede enviar a Meta información del navegador (agente de usuario). Nuestra aplicación no envía tu IP en eventos del servidor ni recoge aquí tu nombre, correo o teléfono; Meta recibe información de red como tu IP cuando se conecta su Pixel. No guardamos estos identificadores del navegador ni los eventos del servidor en nuestra base de datos o registros. Meta procesa los datos según sus propias políticas. Puedes rechazar o retirar tu permiso para la medición opcional aquí cuando quieras.",
    "landing.privacy.body": "Los pedidos se hacen en el sitio del proveedor de pedidos. Esta página no tiene formularios para clientes. La medición opcional empieza solo si aceptas y se desactiva con Do Not Track o Global Privacy Control. Contamos clics aproximados por día, tienda y código de anuncio aprobado, no compras ni personas únicas. No guardamos identificadores personales en ese contador.",
    "landing.consent.notice": "Con tu permiso, contamos clics de pedidos y, si está configurado, compartimos visitas y clics con Meta para entender nuestros anuncios. Puedes pedir con cualquier opción."
  }
} as const;
it("adds intent disclosure without removing any previous privacy or consent text",()=>{
  for(const lang of ["en","es"] as const) {
    const current=lang==="en"?en:es;
    for(const key of Object.keys(before[lang]) as (keyof typeof before.en)[]) {
      expect(current[key].startsWith(before[lang][key]),`${lang}:${key}`).toBe(true);
      expect(current[key].length).toBeGreaterThan(before[lang][key].length);
    }
  }
  expect(en["landing.privacy.meta"]).toContain("Meta also receives directions taps");
  expect(en["landing.privacy.meta"]).toContain("pickup or delivery");
  expect(es["landing.privacy.meta"]).toContain("Meta tambi\u00e9n recibe los toques de indicaciones");
  expect(es["landing.privacy.body"]).toContain("intenci\u00f3n");
  expect(es["marketing.taps.by_intent"]).toBe("Clics por intenci\u00f3n");
});
