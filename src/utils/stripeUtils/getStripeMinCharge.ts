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

/**
 * Get the minimum charge Stripe will accept in the settlement currency
 * in Stripe's units.  The settlement currency isn't necessarily the transaction
 * currency.  We can't actually know what the settlement currency is but
 * the transaction currency is a good guess.  This value should be configurable
 * where it's used in case the guess is wrong.
 */
export function getStripeMinCharge(currency: string): number {
    return stripeMinCharges[currency.toLowerCase()] || 0;
}
