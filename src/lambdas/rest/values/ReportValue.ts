import {Value} from "../../../model/Value";

export type ReportValue =
    Omit<Omit<Value, "genericCodeOptions">, "balance">
    & { genericCodeOptions_perContact_balance: number | string | null, genericCodeOptions_perContact_usesRemaining: number | string | null, balance: number | string | null };
