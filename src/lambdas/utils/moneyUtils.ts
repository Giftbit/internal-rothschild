"use strict";

/**
 * Bankers rounding is to help make results that end in .5 from always rounding up.
 * The problem with always rounding up on .5's in respect to money is that it is favoured.
 * Bankers rounding attempts to make rounding more fair. Now, results that end in x.5 will be
 * evaluated based on whether x is even or odd. If even, round down. If odd, round up.
 * ie:
 *  - bankersRounding(0.5, 0) => 0
 *  - bankersRounding(1.5, 0) => 2
 */
// source http://stackoverflow.com/a/3109234
export function bankersRounding(num, decimalPlaces) {
    let d = decimalPlaces || 0;
    let m = Math.pow(10, d);
    let n = +(d ? num * m : num).toFixed(8); // Avoid rounding errors
    let i = Math.floor(n), f = n - i;
    let e = 1e-8; // Allow for rounding errors in f
    let r = (f > 0.5 - e && f < 0.5 + e) ?
        ((i % 2 === 0) ? i : i + 1) :
        Math.round(n);

    return d ? r / m : r;
}
