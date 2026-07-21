# Toast CATERING menu — Compliments Only (scraped 2026-07-21)

Source: `https://www.toasttab.com/catering/compliments-only-capitol-hill-526-8th-street-southeast`
(same for P Street). Captured via Playwright `browser_snapshot`. Feeds 6d (packages) +
catering à-la-carte reference prices. Packages seed per-location (both shops, same price).

## Catering Packages → catering_packages

### Sandwich Platters (choose from: Classics = Teamster/Crunchy Boi/Farmers Market After Dark; Favorites = Teamster/Crunchy Boi/Marisa Tomei/Hot Pants) — 5" sandwiches
| Package | Price | Serves | min_headcount |
|---|---|---|---|
| 8 pc platter | 60.00 | 4-6 | 4 |
| 16 pc platter | 115.00 | 8-16 | 8 |
| 32 pc platter | 210.00 | 16-32 | 16 |
| 48 pc platter | 330.00 | 24-48 | 24 |

### Individual Lunch Boxes
| Package | Price | Contents | min_headcount |
|---|---|---|---|
| Light Lunch | 12.00 | 5" sub of choice + mini utz + water + napkin | 1 |
| Full Lunch | 19.99 | 10" sub + assorted utz + water | 1 |

### Really Big Subs (choose Teamster or Crunchy Boi)
| Package | Price | Serves | Lead time | min_headcount |
|---|---|---|---|---|
| Three Footer | 135.00 | 6-12 | 48 hrs | 6 |
| Six Footer | 260.00 | 15-20 | 72 hrs | 15 |

## Catering À La Carte (catering prices — REFERENCE for Juan's rate rules; menu_items carry regular price)
| Item | Catering price |
|---|---|
| The Teamster | 16.29 |
| Marisa Tomei Eats Free | 15.29 |
| Hot Pants | 15.79 |
| Crunchy Boi | 15.79 |
| Farmers Market After Dark | 12.65 |
| The Frex | 18.39 |
| Sicky Wicky Club | 15.79 |
| Never Been Cheddar | 15.29 |
| Regular BLT | 10.00 |
| It's a BOI | 15.79 |
| Whole Grain Chicken Salad | 7.50 |
| Tuna Salad 1/2 Pint | 4.25 |
| French Onion Dip | 5.00 |
| AntiPasto Pasta | 6.00 |
| Egg Salad- 1/2 pint | 4.25 |
| Egg Salad Sandwich | 10.49 |
| Veggie Sub | 9.49 |
| Turkey Sandwich | 14.19 |
| Ham Sandwich | 13.19 |
| Roast Beef Sandwich | 14.19 |
| Salami Sandwich | 13.19 |
| Pepperoni Sandwich | 13.19 |
| Tomato & Mozz Sandwich | 13.49 |
| Utz chips (each variant) | 3.25 |
| Mini Chips- Utz Original | 0.75 |

## Catering Sides / Sweets / Drinks (catering page)
| Item | Price |
|---|---|
| House Greek Salad | 12.00 |
| Quart of Pickle Spears (12pcs) | 9.00 |
| Large French Onion Dip (32oz) | 20.00 |
| Case of Mini Chips (24 bags) | 20.00 |
| Case of Assorted Chips (24 lg bags) | 52.00 |
| Large Tuna Salad (32oz) | 18.00 |
| Large Pasta Salad (32oz) | 16.00 |
| Large Egg Salad (32oz) | 16.00 |
| Caesar Sal(ad) | 12.00 |
| Whisked Chocolate Chip Cookie | 2.25 |
| Berger Cookies - 2 pk | 4.00 |
| Berger Cookies- Large | 9.99 |
| Fruity Pebble Cannoli (single) | 2.00 |
| Dozen Waters | 12.00 |
| 24 mixed sodas | 48.00 |
| Saratoga / Topo Chico Lime | 3.00 |
| Natalie's Lemonade | 3.41 |
| Coke / Diet Coke | 2.79 |
| Water Bottle | 1.99 |
| DB sodas (each) | 2.99 |
| JustIced Teas (each) | 3.25 |

**Note:** the platters are "choose-from-group" → `catering_package_slot_options` referencing
the sub `menu_items` (W1b). Lunch boxes = "sub of choice" (slot). Footers = choose 1 of 2.
Large sides (32oz) are bulk versions of the prepped-item sides.
