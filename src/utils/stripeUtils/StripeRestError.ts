import * as cassava from "cassava";
import * as Stripe from "stripe";

export class StripeRestError extends cassava.RestError {

    readonly isStripeRestError = true;

    constructor(statusCode: number, message: string, messageCode: string, stripeError: Stripe.IStripeError) {
        super(statusCode, message, {
            messageCode,
            stripeError: StripeRestError.santizeStripeError(stripeError)
        });
    }

    get stripeError(): Stripe.IStripeError {
        return this.additionalParams["stripeError"];
    }

    get messageCode(): string {
        return this.additionalParams["messageCode"];
    }

    /**
     * Remove properties of the StripeError we don't want to share.
     * @param error
     */
    static santizeStripeError(error: Stripe.IStripeError): Stripe.IStripeError {
        return {
            ...error,
            type: error.type,   // This comes from a getter now and isn't copied in the spread above.
            stack: undefined
        } as any;
    }

    static isStripeRestError(err: any): err is StripeRestError {
        return !!(err as StripeRestError).isStripeRestError;
    }
}
