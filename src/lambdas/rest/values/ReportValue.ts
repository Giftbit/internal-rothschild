import {Value} from "../../../model/Value";

type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;
export type ReportValue =
    Omit<Value, "genericCodeOptions">
    & { genericCodeOptions_perContact_balance: number | null, genericCodeOptions_perContact_usesRemaining: number | null };