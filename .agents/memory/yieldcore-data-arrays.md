---
name: YieldCore data-array farm-name conventions
description: How farm records are keyed across the dashboard's data arrays and how cross-module logic must join them
---
# Farm-name keys differ across arrays (index.html)

`yieldFarms` uses SHORT names (`farm:'Rodwell Naicker'`, `'Green Fields'`, `'Oranjezicht'`), while `farmHealth`, `irrigFarms`, `npkFarms`, `solarFarms`, `carbonFarms`, `pestData` use FULL names (`'Rodwell Naicker Farm'`, `'Green Fields Farm'`, `'Oranjezicht City Farm'`).

**Why:** these arrays were authored independently; there is no shared farm-id. Any cross-module join (e.g. computing a farm's crop value for the AI Decision Center) must fuzzy-match, not use `===`.

**How to apply:** join on the first 1–2 lowercased words (see `_yieldOf`/`_cropValue` in `renderDecisionSupport`). When a farm has no `yieldFarms` entry (e.g. Winnchoulas, Imhoff), fall back to `ha × median(yieldT×priceR)` so impact math stays finite. `_haOf` reads `ha` from `carbonFarms` first (it lists all farms incl. unenrolled), then `farmHealth`.

# AI Decision Center is fully data-derived
`renderDecisionSupport` builds every card from the live arrays and ranks by a computed ZAR `impactZAR` (pest = cropValue×sevLoss×confidence; irrigation = cropValue×moisture-deficit factor; NPK = uplift; solar = recoverable kWh×tariff; carbon = rate×ha×price; market = grain value×premium×lock-in). Do NOT reintroduce hardcoded decision text — it drifts from the data (the old version referenced non-existent farms and called wrong fn signatures).
