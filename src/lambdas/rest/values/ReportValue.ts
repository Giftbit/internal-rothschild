import {Value} from "../../../model/Value";

// todo - should it be omitted? is this the best way to omit stuff? I think just return the rule. People can complain via reports if this is a problem.
export type ReportValue =
    Omit<Omit<Omit<Value, "discountSellerLiabilityRule">, "genericCodeOptions">, "balance">
    & { genericCodeOptions_perContact_balance: number | string | null, genericCodeOptions_perContact_usesRemaining: number | string | null, balance: number | string | null };
