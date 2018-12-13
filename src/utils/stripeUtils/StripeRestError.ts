import * as cassava from "cassava";
import * as Stripe from "stripe";

export class StripeRestError extends cassava.RestError {

    readonly isStripeRestError = true;

    constructor(statusCode: number, message: string, messageCode: string, public stripeError: Stripe.IStripeError) {
        super(statusCode, message, {
            messageCode,
            stripeError
        });
    }
}
