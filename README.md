# CHIP Temp & Power Analyzer

Live website: https://xyz3862777-crypto.github.io/chip-temp-analyzer/

Open `index.html` directly in a browser. It has no external dependencies. Inputs and results update locally.

## Electrical model

- Five equal series-R / shunt-C panel sections: page default total 8 kΩ and 180 pF for the supplied 85-inch panel, or 1.6 kΩ and 36 pF per section.
- ROUTSWP/N = 600 Ω, RESD = 100 Ω, independent RWOA = 1 Ω per channel. Only ROUTSW + RESD resistor losses count as chip AC heat.
- P/N each serve 480 of 960 channels. Base ΔVP/ΔVN defaults to 8.6 V, while effective ΔV is dynamically reduced by PWRC, DBC, SRE, and panel RC loading. The model uses the periodic RC state, including incomplete settling, and analytically integrates I²R across each line.
- `Tline = 1 / (frame rate × active resolution height)`. The 0.2 μs blanking interval is included within the line. Source low bias remains enabled in blanking; the ideal RC path stays connected.
- Source low current per OP = 7 μA × PWRC ratio. DBC high current multiplies that value by the DBC_DRV ratio. One OP per channel, powered at 18 V.
- Confirmed PWRC codes: 000=100%, 001=80%, 010=60%, 100=200%, 101=180%, 110=160%. Other codes retain the earlier table values until measured settings are provided.
- DBC_DRV 00/01/10/11: 5×/3×/9×/7×. The supplied measurement uses DBC_DRV=00 and DBC_W=280 ns; the live model accepts both duration and percentage, with duration taking priority. Boost begins at line start and ends before blanking. Source DC uses the time-weighted current, including the low-bias remainder.
- Other circuits draw a fixed 3 mA at 18 V: 54 mW per chip, counted once.
- SRE and DBC increase Source bias while reducing effective ΔV. The UI exposes the reduction and heavy-load sensitivity coefficients as slide-derived calibration approximations until measured ΔV tables are available.
- Resolution width is metadata. It does not implicitly set channel count or scale power.

Page default 180 Hz / 1920-line results at PWRC=000 (100%), DBC_DRV=00 (5×), DBC_W=280 ns:

| Quantity | Value |
| --- | ---: |
| ACP / channel | 0.398019161 mW |
| ACN / channel | 0.398019161 mW |
| Total chip AC | 382.098394 mW |
| Source DC | 167.780229 mW |
| Other DC | 54.000000 mW |
| Total power | 603.878623 mW |

## Temperature

`T = X + Y × (AC + DC)`, power in mW. The page defaults to the supplied two-point measurement fit, X=6.754050 °C and Y=0.17436608 °C/mW, which maps the default DC and AC+DC powers to the measured White and H-stripe means at 180 Hz. Replace them when the operating point changes.

This ideal model excludes finite slew rate and output-transistor losses beyond the on-chip series resistors; it is not a full transistor-level simulation.

## Supplied calibration references

The page includes the supplied reference points as a calibration aid:

- Measured H-stripe (AC+DC) averages: 112.8, 112.6, 111.0, 111.8 °C for default, LL, LH, HL; White (DC) averages: 45.4, 45.0, 45.6, 45.7 °C. The four-point means are 112.05 °C and 45.425 °C, so the mean AC temperature rise is 66.625 °C.
- Simulation at 6 kΩ / 400 pF and PWRC=000 (100%), using the right-hand simulation column only: 140 kHz STATIC 8.2 mA and DYNAMIC 80.0 mA (AC 71.8 mA); 280 kHz STATIC 9.4 mA and DYNAMIC 112.7 mA (AC 103.3 mA).
- Measurement setup: 85-inch panel, 8 kΩ / 180 pF, 180 Hz, 3840×1920, DBC 5× with DBC_W=280 ns, SRE disabled. LL=PWRC 000 (100%), LH=PWRC 001 (80%), HL=PWRC 010 (60%). The default page inputs and measured two-point temperature coefficients use this setup directly.

The page directly applies the measured setup and two-point coefficients. The coefficients map the model's DC and AC+DC power to the measured means and should be replaced when the voltage or operating mode changes.

## Verification

Run `node model.test.cjs`. Tests cover energy conservation, an independent RK4 reference for settled and incompletely settled transitions, voltage and channel scaling, duty and ratio mappings, dynamic ΔV behavior for DBC/SRE/PWRC/heavy loading, fixed power and timing validation. `model.cjs` mirrors the solver embedded in the standalone HTML.
