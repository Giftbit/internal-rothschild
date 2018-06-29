import {AuthorizationBadge} from "giftbit-cassava-routes/dist/jwtauth";
import {computeLookupHash, encrypt} from "../codeCryptoUtils";

export class DbCode {
    encryptedCode: string;
    codeHashed: string;
    lastFour: string;
    genericCode: boolean;

    constructor(plaintextCode: string, genericCode: boolean, auth: AuthorizationBadge) {
        this.encryptedCode = encrypt(plaintextCode);
        this.codeHashed = computeLookupHash(plaintextCode, auth);
        this.lastFour = codeLastFour(plaintextCode);
        this.genericCode = genericCode;
    }
}

export function codeLastFour(code: string) {
    return "…" + code.slice(-4);
}
