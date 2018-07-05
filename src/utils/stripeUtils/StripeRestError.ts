import * as cassava from "cassava";

export class StripeRestError extends cassava.RestError {
    constructor(statusCode?: number, message?: string, messageCode?: string, stripeError?: object) {
        let additionalProps: any = {};
        if (messageCode) {
            additionalProps.messageCode = messageCode;
        }
        if (stripeError) {
            additionalProps.stripeError = stripeError;
        }
        super(statusCode, message, additionalProps);
    }
}
