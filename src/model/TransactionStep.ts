import * as stripe from "stripe";
import {Rule} from "./Value";

export type TransactionStep = LightrailTransactionStep | StripeTransactionStep | InternalTransactionStep;

export interface LightrailTransactionStep {
    rail: "lightrail";
    valueId: string;
    contactId?: string;
    code?: string;
    balanceRule: Rule | null;
    balanceBefore: number;
    balanceAfter: number;
    balanceChange: number;
    usesRemainingBefore?: number;
    usesRemainingAfter?: number;
    usesRemainingChange?: number;
}

export interface StripeTransactionStep {
    rail: "stripe";
    amount: number;
    chargeId?: string;
    charge?: stripe.charges.ICharge | stripe.refunds.IRefund;
}

export interface InternalTransactionStep {
    rail: "internal";
    internalId: string;
    balanceBefore: number;
    balanceAfter: number;
    balanceChange: number;
}

export type DbTransactionStep = LightrailDbTransactionStep | StripeDbTransactionStep | InternalDbTransactionStep;

export interface LightrailDbTransactionStep {
    userId: string;
    id: string;
    transactionId: string;
    valueId: string;
    contactId?: string;
    code?: string;
    balanceRule: string | null;
    balanceBefore: number | null;
    balanceAfter: number | null;
    balanceChange: number | null;
    usesRemainingBefore: number | null;
    usesRemainingAfter: number | null;
    usesRemainingChange: number | null;
}

export interface StripeDbTransactionStep {
    userId: string;
    id: string;
    transactionId: string;
    chargeId: string;
    amount: number;
    charge: string;
}

export interface InternalDbTransactionStep {
    userId: string;
    id: string;
    transactionId: string;
    internalId: string;
    balanceBefore: number;
    balanceAfter: number;
    balanceChange: number;
}

export namespace DbTransactionStep {
    export function toTransactionStep(step: DbTransactionStep): TransactionStep {
        if (isLightrailDbTransactionStep(step)) {
            return toLightrailTransactionStep(step);
        }
        if (isStripeDbTransactionStep(step)) {
            return toStripeTransactionStep(step);
        }
        if (isInternalDbTransactionStep(step)) {
            return toInternalTransactionStep(step);
        }
    }

    export function isLightrailDbTransactionStep(step: DbTransactionStep): step is LightrailDbTransactionStep {
        return (step as LightrailDbTransactionStep).valueId !== undefined;
    }

    export function isStripeDbTransactionStep(step: DbTransactionStep): step is StripeDbTransactionStep {
        return (step as StripeDbTransactionStep).chargeId !== undefined;
    }

    export function isInternalDbTransactionStep(step: DbTransactionStep): step is InternalDbTransactionStep {
        return (step as InternalDbTransactionStep).internalId !== undefined;
    }

    export function toLightrailTransactionStep(step: LightrailDbTransactionStep): LightrailTransactionStep {
        return {
            rail: "lightrail",
            valueId: step.valueId,
            contactId: step.contactId || null,
            code: step.code || null,
            balanceBefore: step.balanceBefore,
            balanceAfter: step.balanceAfter,
            balanceChange: step.balanceChange,
            balanceRule: step.balanceRule ? JSON.parse(step.balanceRule) : null,
            usesRemainingBefore: step.usesRemainingBefore,
            usesRemainingAfter: step.usesRemainingAfter,
            usesRemainingChange: step.usesRemainingChange
        };
    }

    export function toStripeTransactionStep(step: StripeDbTransactionStep): StripeTransactionStep {
        return {
            rail: "stripe",
            amount: step.amount,
            chargeId: step.chargeId || null,
            charge: JSON.parse(step.charge) || null
        };
    }

    export function toInternalTransactionStep(step: InternalDbTransactionStep): InternalTransactionStep {
        return {
            rail: "internal",
            internalId: step.internalId,
            balanceBefore: step.balanceBefore,
            balanceAfter: step.balanceAfter,
            balanceChange: step.balanceChange,
        };
    }
}
