import {LineItemRequest} from "./LineItem";
import {TaxRequestProperties} from "./TaxProperties";
import * as jsonschema from "jsonschema";

export interface CheckoutRequest {
    id: string;
    lineItems: LineItemRequest[];
    currency: string;
    sources: TransactionParty[];
    simulate?: boolean;
    allowRemainder?: boolean;
    tax?: TaxRequestProperties;
    pending?: boolean | string;
    metadata?: object;
}

export interface CreditRequest {
    id: string;
    destination: TransactionParty;
    amount?: number;
    uses?: number;
    currency: string;
    simulate?: boolean;
    metadata?: object;
}

export interface DebitRequest {
    id: string;
    source: TransactionParty;
    amount?: number;
    uses?: number;
    currency: string;
    simulate?: boolean;
    allowRemainder?: boolean;
    pending?: boolean | string;
    metadata?: object;
}

export interface ReverseRequest {
    id: string;
    simulate?: boolean;
    metadata?: object;
}

export interface CaptureRequest {
    id: string;
    simulate?: boolean;
    metadata?: object;
}

export interface VoidRequest {
    id: string;
    simulate?: boolean;
    metadata?: object;
}

export type TransferRequest = CreditRequest & DebitRequest;

export type TransactionParty = LightrailTransactionParty | StripeTransactionParty | InternalTransactionParty;

export interface LightrailTransactionParty {
    rail: "lightrail";
    contactId?: string;
    code?: string;
    valueId?: string;
}

export interface StripeTransactionParty {
    rail: "stripe";
    source?: string;
    customer?: string;
    maxAmount?: number;
    minAmount?: number;
    forgiveSubMinAmount?: boolean;
    additionalStripeParams?: AdditionalStripeChargeParams;
}

export interface AdditionalStripeChargeParams {
    application_fee?: string;
    application_fee_amount?: number;
    description?: string;
    on_behalf_of?: string;
    receipt_email?: string;
    shipping?: {
        address?: {
            city?: string;
            country?: string;
            line1?: string;
            line2?: string;
            postal_code?: string;
            state?: string;
        }
        carrier?: string;
        name?: string;
        phone?: string;
        tracking_number?: string;
    };
    statement_descriptor?: string;
    transfer_group?: string;
}

export interface InternalTransactionParty {
    rail: "internal";
    internalId: string;
    balance: number;
    pretax?: boolean;
    beforeLightrail?: boolean;
}

export namespace transactionPartySchema {
    export const lightrail: jsonschema.Schema = {
        title: "lightrail",
        type: "object",
        additionalProperties: false,
        properties: {
            rail: {
                type: "string",
                enum: ["lightrail"]
            },
            contactId: {
                type: "string"
            },
            code: {
                type: "string"
            },
            valueId: {
                type: "string"
            }
        },
        oneOf: [
            {
                title: "lightrail specifies contactId",
                required: ["contactId"]
            },
            {
                title: "lightrail specifies code",
                required: ["code"]
            },
            {
                title: "lightrail specifies valueId",
                required: ["valueId"]
            }
        ],
        required: ["rail"]
    };

    /**
     * Can only refer to a single value store.
     */
    export const lightrailUnique: jsonschema.Schema = {
        title: "lightrail",
        type: "object",
        additionalProperties: false,
        properties: {
            rail: {
                type: "string",
                enum: ["lightrail"]
            },
            code: {
                type: "string"
            },
            valueId: {
                type: "string"
            }
        },
        oneOf: [
            {
                title: "lightrail specifies code",
                required: ["code"]
            },
            {
                title: "lightrail specifies valueId",
                required: ["valueId"]
            }
        ],
        required: ["rail"]
    };

    export const stripe: jsonschema.Schema = {
        title: "stripe",
        type: "object",
        additionalProperties: false,
        properties: {
            rail: {
                type: "string",
                enum: ["stripe"]
            },
            source: {
                type: "string"
            },
            customer: {
                type: "string"
            },
            maxAmount: {
                type: "integer",
                minimum: 1
            },
            minAmount: {
                type: "integer",
                minimum: 0
            },
            forgiveSubMinAmount: {
                type: "boolean"
            },
            additionalStripeParams: {
                type: "object",
                additionalProperties: false,
                properties: {
                    application_fee: {
                        type: ["string", "null"]
                    },
                    application_fee_amount: {
                        type: ["integer", "null"]
                    },
                    description: {
                        type: ["string", "null"]
                    },
                    on_behalf_of: {
                        type: ["string", "null"]
                    },
                    receipt_email: {
                        type: ["string", "null"]
                    },
                    shipping: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                            address: {
                                type: "object",
                                additionalProperties: false,
                                properties: {
                                    city: {
                                        type: ["string", "null"]
                                    },
                                    country: {
                                        type: ["string", "null"]
                                    },
                                    line1: {
                                        type: ["string", "null"]
                                    },
                                    line2: {
                                        type: ["string", "null"]
                                    },
                                    postal_code: {
                                        type: ["string", "null"]
                                    },
                                    state: {
                                        type: ["string", "null"]
                                    }
                                }
                            },
                            carrier: {
                                type: ["string", "null"]
                            },
                            name: {
                                type: ["string", "null"]
                            },
                            phone: {
                                type: ["string", "null"]
                            },
                            tracking_number: {
                                type: ["string", "null"]
                            }
                        }
                    },
                    statement_descriptor: {
                        type: ["string", "null"]
                    },
                    transfer_group: {
                        type: ["string", "null"]
                    }
                }
            }
        },
        anyOf: [
            {
                title: "stripe specifies source",
                required: ["source"]
            },
            {
                title: "stripe specifies customer",
                required: ["customer"]
            },
        ],
        required: ["rail"]
    };

    export const internal: jsonschema.Schema = {
        title: "internal",
        type: "object",
        additionalProperties: false,
        properties: {
            rail: {
                type: "string",
                enum: ["internal"]
            },
            internalId: {
                type: "string",
                minLength: 1,
                maxLength: 64
            },
            balance: {
                type: "integer",
                minimum: 0
            },
            beforeLightrail: {
                type: "boolean"
            },
            pretax: {
                type: "boolean"
            }
        },
        required: ["rail", "internalId", "balance"]
    };
}
