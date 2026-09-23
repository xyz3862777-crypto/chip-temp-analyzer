# CHIP Temp & Power Analyzer

Live website: https://xyz3862777-crypto.github.io/chip-temp-analyzer/

Open `index.html` directly in a browser. It has no external dependencies. Inputs and results update locally.

## Electrical model

- Five equal series-R / shunt-C panel sections: default total 3 kΩ and 200 pF, or 600 Ω and 40 pF per section.
- ROUTSWP/N = 600 Ω, RESD = 100 Ω, independent RWOA = 1 Ω per channel. Only ROUTSW + RESD resistor losses count as chip AC heat.
- P/N each serve 480 of 960 channels. One alternating 8.6 V transition per line. The model uses the periodic RC state, including incomplete settling, and analytically integrates I²R across each line.
- `Tline = 1 / (frame rate × active resolution height)`. The 0.2 μs blanking interval is included within the line. Source low bias remains enabled in blanking; the ideal RC path stays connected.
- Source low current per OP = 7 μA × PWRC ratio. DBC high current multiplies that value by the DBC_DRV ratio. One OP per channel, powered at 18 V.
- PWRC 000–111: 120%, 100%, 90%, 80%, 60%, 50%, 45%, 40%.
- DBC_DRV 00/01/10/11: 5×/3×/9×/7×. DBC_W is a percentage of the full line. Boost begins at line start and ends before blanking. Source DC uses the time-weighted current, including the low-bias remainder.
- Other circuits draw a fixed 3 mA at 18 V: 54 mW per chip, counted once.
- Resolution width is metadata. It does not implicitly set channel count or scale power.

Default 60 Hz / 1080-line results at PWRC=100 (60%), DBC_DRV=00 (5×), DBC_W=10%:

| Quantity | Value |
| --- | ---: |
| ACP / channel | 0.176017469 mW |
| ACN / channel | 0.176017469 mW |
| Total chip AC | 168.976770 mW |
| Source DC | 101.606400 mW |
| Other DC | 54.000000 mW |
| Total power | 324.583170 mW |

## Temperature

`T = X + Y × (AC + DC)`, power in mW. Default X=25 °C and Y=0.077021862 °C/mW are **demonstration values**, chosen to produce about 50 °C at the default operating point. Y stays fixed when inputs change. Replace them with measured calibration coefficients before interpreting temperature as a prediction.

This ideal model excludes finite slew rate and output-transistor losses beyond the on-chip series resistors; it is not a full transistor-level simulation.

## Verification

Run `node model.test.cjs`. Tests cover energy conservation, an independent RK4 reference for settled and incompletely settled transitions, voltage and channel scaling, duty and ratio mappings, fixed power and timing validation. `model.cjs` mirrors the solver embedded in the standalone HTML.
