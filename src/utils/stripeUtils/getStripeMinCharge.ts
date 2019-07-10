/**
 * Get the minimum charge Stripe will accept in the settlement currency
 * in Stripe's units.
 */
export function getStripeMinCharge(currency: string): number {
    return stripeMinCharges[currency.toLowerCase()] || 0;
}

/**
 * Maps lower-case currency code to stripe min charge.  This amount is represented in
 * the units Stripe uses.
 * @see https://stripe.com/docs/currencies#minimum-and-maximum-charge-amounts
 */
const stripeMinCharges: { [code: string]: number } = {
    usd: 50,
    aud: 50,
    brl: 50,
    cad: 50,
    chf: 50,
    dkk: 250,
    eur: 50,
    hkd: 400,
    jpy: 50,
    mxn: 10,
    nok: 300,
    nzd: 50,
    sek: 300,
    sgd: 50
};
