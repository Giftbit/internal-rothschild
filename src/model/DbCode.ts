import {computeLookupHash, encrypt} from "../services/codeCryptoUtils";
import {AuthorizationBadge} from "giftbit-cassava-routes/dist/jwtauth";

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
    return "...".concat(code.substring(code.length - 4));
}
