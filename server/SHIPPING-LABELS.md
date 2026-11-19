# Express shipping + buy & print labels (Nov 2026)

## What it does

- **Checkout:** customers choose **Standard** (flat $20, free over $200) or **Express** (flat $45, USPS Priority Mail Express). Wholesale kits keep their zone rates and don't offer Express. The order saves `shipping_service = 'express'` and its note starts with "Delivery method: Shipping · EXPRESS".
- **Owner app → order → Buy & print label:** pick a box preset, choose what's in the box, and get live USPS and UPS rates from Shippo. Express orders pre-select Priority Mail Express. Buy one, then print the 4×6 PDF. The shipment is recorded exactly like "Ship it", and the usual Shipped email preview follows.
- **On each order:** bought labels are listed with **Reprint** and **Void** buttons. Void unused labels to get the postage refunded to the Shippo account.
- **Label settings** (inside the label sheet) store the ship-from address, phone, box presets and label size (4×6 or 8.5×11).

## Files

| File | Change |
| --- | --- |
| `server/sql/99h_shipping_labels.sql` | New: `orders.shipping_service`, `ppu_ship_settings`, `ppu_shipping_labels` (owner-only RLS) |
| `server/functions/ship-label/index.ts` | New edge function: rates, buy, void, status. Owner-only (checks `admin_users`). |
| `staging/js/pst-core.js` | `CFG.expressRate = 45`, `CFG.labelFn`, `shipQuote(..., speed)`, `submitOrder({ speed })` |
| `staging/js/pst-cart.js` | Standard / Express picker in the Delivery box |
| `staging/js/ppu-owner-labels.js` | New: the label sheet, settings, reprint/void list |
| `staging/js/pst-owner-ops.js` | "Buy & print label" button, EXPRESS badge, label list on the order |
| `staging/owner.html`, `staging/cart.html`, `staging/*.html`, `staging/sw.js` | Version bumps + load `ppu-owner-labels.js` |

## Install (staging first)

1. **Shippo account:** sign up at goshippo.com. Under Settings → API, copy the **test** key (`shippo_test_…`).
2. **Database:** in the Supabase SQL editor, run `server/sql/99h_shipping_labels.sql`. It's safe to re-run.
3. **Edge function:** deploy `server/functions/ship-label` with **JWT verification off**, like the other functions. Add the secret `SHIPPO_API_KEY` = the test key.
4. **Push** the `staging/` changes, then on a phone open `/staging/owner.html`:
   - open a paid order → **Buy & print label** → it asks for the ship-from address the first time → save
   - get rates → buy → check the test label PDF opens and the order shows as shipped
   - on the order, **Void** the test label
   - on `/staging/cart.html`, check Standard/Express change the shipping and total
5. **Go live:** copy the five staging JS/HTML changes to the root files (same version bumps), push, then swap `SHIPPO_API_KEY` to the **live** key (`shippo_live_…`) and add a payment method in Shippo.

Test-mode labels are free and can't be mailed; the sheet shows a "Test mode" note while the test key is in use.

## Notes

- The Shippo key is only in the edge function. Browsers never see it.
- The buy step refuses a second label for the same order unless the owner confirms (`allow_another`).
- If the label is bought but saving the shipment fails, the sheet says so and shows the tracking number to enter with "Ship it".
- Express is a flat price in `CFG.expressRate` (`staging/js/pst-core.js`; live copy in `js/pst-core.js`).
