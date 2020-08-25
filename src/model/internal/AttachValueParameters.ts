import {ValueIdentifier} from "./ValueIdentifier";

export interface AttachValueParameters {
    contactId: string;
    valueIdentifier: ValueIdentifier;
    allowOverwrite: boolean;
    /**
     * @deprecated only supported for yervana
     */
    attachGenericAsNewValue?: boolean;
}