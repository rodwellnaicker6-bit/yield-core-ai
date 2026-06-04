---
name: Enterprise ROI / net-gain tie-out
description: How the ROI Dashboard headline must stay internally consistent with its displayed component tiles
---
# ROI net gain must equal the sum of its displayed ZAR component tiles

`entMetrics()` (index.html) computes the enterprise ROI. The headline `netGainR` is defined as `revIncreaseR + costSaveR + carbonRevR + solarSaveR` — i.e. exactly the four ZAR component tiles the ROI module renders (Revenue Increase, Cost Savings, Carbon Revenue, Solar Savings). `roiPct=((netGainR-feeR)/feeR)*100`, `roiX=netGainR/feeR`, `feeR=PLATFORM_FEE_HA_MO*12*totalHa`.

**Why:** an investor reviewer flagged that an earlier version set net gain from a hardcoded per-hectare profit (R3,200/ha) that did NOT equal the sum of the visible tiles — the headline contradicted the breakdown shown right below it. Components must be derived from existing live arrays (revIncrease from yieldFarms, cost from revR+suppliers, carbon from carbonFarms, solar from solarLive) so the number ties out to the rest of the dashboard.

**How to apply:** if you add/remove an ROI component tile, update `netGainR` in lockstep so headline == sum of tiles. Keep the brand uplift constants (yield +18%, water −32%, chem −40%) matching the topbar yield-ribbon, since those are the app-wide narrative figures. `PLATFORM_FEE_HA_MO` (R65/ha/mo) is a documented pricing assumption, not derived.

# CSV export must neutralise formula injection
`_csv()` prefixes any cell starting with `= + - @ \t \r` with a single quote before serialising, so farm names / user-influenced fields can't execute as spreadsheet formulas when opened in Excel.
