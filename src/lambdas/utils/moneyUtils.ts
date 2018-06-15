"use strict";

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
