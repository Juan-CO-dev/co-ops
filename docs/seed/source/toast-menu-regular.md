# Toast REGULAR menu — Compliments Only (scraped 2026-07-21)

Source: `https://order.toasttab.com/online/compliments-only-capitol-hill-526-8th-street-southeast`
(same menu for P Street). Captured via Playwright `browser_snapshot`. Prices = regular
online price → `menu_items.menu_price`. Stage 6 source of truth for the full menu mirror.

## Signature Subs (→ menu_items, catering_portionable=true; 11 have builds in sandwich-build-sheet.csv)
| Item | Price | Build source |
|---|---|---|
| Crunchy Boi | 15.79 | build sheet |
| The Teamster | 16.29 | build sheet |
| Marisa Tomei Eats Free | 15.29 | build sheet (Marisa Tomei) |
| Farmers Market After Dark | 12.09 | build sheet (Farmers Market) |
| Never Been Cheddar | 15.29 | build sheet |
| Hot Pants | 15.79 | build sheet |
| Turkey Caesar Sub | 16.79 | build sheet (Turkey Ceasar) |
| The Frex | 18.39 | build sheet (Frex) |
| It's a BOI | 15.79 | variant of Crunchy Boi (choose-meat) — simple build |
| Vesuvio II | 19.99 | build sheet (Vesuvio) |
| Sicky Wicky Club | 15.79 | build sheet |
| Our French Dip | 18.99 | build sheet (French Dip) |
| Regular BLT | 10.00 | desc: Bacon, Lettuce, Tomato, Duke's Mayo — simple build |
| The chicken cutlet | 19.50 | Chicken Cutlet item + fixings — simple build |
| Chicken parm | 19.99 | desc: Marinara, vodka sauce, pepperoncini, mozz, provolone, oregano — simple build |

## Build Your Own (→ menu_items, catering_portionable=true; simple builds)
| Item | Price |
|---|---|
| Tuna Salad Sub | 10.49 |
| Egg Salad Sub | 10.49 |
| Turkey Sub | 14.19 |
| Roast Beef Sub | 14.19 |
| Veggie Sub | 9.49 |
| Ham Sub | 13.19 |
| Salami Sub | 13.19 |
| Pepperoni Sub | 13.19 |
| Chicken Salad (sub) | 16.00 |

## Chips & Sides (prepped-item sides → items.sold_directly; resale chips → menu_items)
| Item | Price | Kind |
|---|---|---|
| Deli Pickle | 3.00 | resale (BH pickle) |
| Garlic Bread | 12.50 | side (Compound Butter + roll) |
| Side of Meatballs | 5.50 | item.sold_directly (Meatballs) |
| Egg Salad- 1/2 pint | 4.25 | item.sold_directly (Egg Salad) |
| Whole Grain Chicken Salad | 7.50 | item.sold_directly (Chix Salad) |
| Tuna Salad 1/2 Pint | 4.25 | item.sold_directly (Tuna Salad) |
| French Onion Dip | 5.00 | item.sold_directly (Onion Dip) |
| Quart of Pickle Spears (12pcs) | 9.00 | resale (BH pickle) |
| AntiPasto Pasta | 6.00 | item.sold_directly (Antipasto Pasta) |
| Bacon Caesar Pasta Salad | 9.00+ | new item (defer build; menu_item or item) |
| Roasted Red Peppers | 4.00+ | resale/item (Roasted Red Peppers SKU) |
| Stuffed Peppers | 16.00 | new item (cherry peppers + provolone + prosciutto) |
| MeatBall Parm | 10.00 | side (Meatballs + marinara/vodka + cheese) |

## Drinks (→ menu_items, catering_available=true)
| Item | Price |
|---|---|
| Dr. Browns Root Beer | 2.99 |
| Dr. Brown's Cream Soda | 2.99 |
| Dr. Browns Diet Cream Soda | 2.99 |
| Dr. Browns Black Cherry | 2.99 |
| Dr. Browns Diet Black Cherry | 2.99 |
| Dr. Browns Cel-Ray Soda | 2.99 |
| Coke | 2.79 |
| Diet Coke | 2.79 |
| Topo Chico Lime | 3.00 |
| Saratoga | 3.00 |
| JustIced Tea- Raspberry Tea | 3.25 |
| JustIced Tea - Dragon Green tea | 3.25 |
| JustIced Tea- Lemon Tea | 3.25 |
| Natalie's Lemonade | 3.41 |
| Water Bottle | 1.99 |
| Red Bull | 5.00 |
| Red Bull - Sugar Free | 5.00 |
| Happy Hour Diet Coke | 1.00 |
| Happy Hour Coke | 1.00 |

## Chips (→ menu_items, resale)
| Item | Price |
|---|---|
| Utz Original Chips | 3.25 |
| Utz Salt & Vinegar Chips | 3.25 |
| Utz BBQ Chips | 3.25 |
| Utz Sour Cream & Onion | 3.25 |
| Salt & Pepper Chips | 3.25 |
| Mini Chips- Utz Original | 0.75 |

## Sweets (→ menu_items, catering_available=true, resale)
| Item | Price |
|---|---|
| Whisked Chocolate Chip Cookie | 2.25 |
| Fruity Pebble Cannolis | 4.00 |
| Berger Cookies - 2 pk | 4.00 |
| Berger Cookies- Large | 9.99 |

## Gear (→ menu_items, catering_available=false)
| Item | Price |
|---|---|
| Compliments Only T-Shirt | 35.00 |
| Little Sticker | 1.00 |

**Notes:** `+` prices (Bacon Caesar Pasta Salad $9.00+, Roasted Red Peppers $4.00+) have
size modifiers on Toast — seed the base price, note the modifier. Regular sub prices ≈
catering à-la-carte prices (mostly identical); catering prices live in the catering artifact.
