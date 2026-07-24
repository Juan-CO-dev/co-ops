/**
 * EZCater order fetch (spec #2c). SERVER-ONLY wrapper over the pure
 * normalizer (lib/ezcater/orders-shared.ts). Query fields mirror the
 * orderByID example in the official guide; the schema supports introspection,
 * so the first-live pass extends fields (contact/delivery address are
 * UNDOCUMENTED unknowns) rather than guessing now.
 */
import "server-only";

import { ezcaterGraphql, EzcaterApiError } from "./client";
import { normalizeEzcaterOrder, type EzcaterOrder } from "./orders-shared";

const ORDER_BY_ID_QUERY = `
query orderByID($id: ID!) {
  order(id: $id) {
    orderNumber
    orderSourceType
    event {
      headcount
      timestamp
      catererHandoffFoodTime
      orderType
    }
    caterer {
      uuid
      name
    }
    totals {
      customerTotalDue { currency subunits }
      subTotal { currency subunits }
      tip { currency subunits }
    }
    catererCart {
      orderItems {
        name
        uuid
        totalInSubunits { subunits currency }
        posItemId
        menuItemSizeId
        quantity
        noteToCaterer
        specialInstructions
        customizations {
          customizationId
          name
          quantity
          customizationTypeName
        }
      }
    }
  }
}`;

export async function fetchEzcaterOrder(orderUuid: string): Promise<EzcaterOrder> {
  const json = await ezcaterGraphql<unknown>("orderByID", ORDER_BY_ID_QUERY, { id: orderUuid });
  try {
    return normalizeEzcaterOrder(json);
  } catch (err) {
    throw new EzcaterApiError(502, "bad_payload", err instanceof Error ? err.message : "bad ezCater order payload");
  }
}
