/**
 * Describes the way ValueStoreAccess(es) and their corresponding ValueStore(s) are created.
 */
export interface Program {
    id: string;
    type: "GIFT_CARD" | "PROMOTION";
    valueStoreTemplateId: string;

}