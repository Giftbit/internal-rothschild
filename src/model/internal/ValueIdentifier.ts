export type ValueIdentifier = ValueById | ValueByCode;

export interface ValueById {
    valueId: string;
    code: undefined;
}

export interface ValueByCode {
    valueId: undefined;
    code: string;
}