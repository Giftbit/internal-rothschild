import {AuthorizationBadge} from "giftbit-cassava-routes/dist/jwtauth";
import {computeCodeLookupHash, encryptCode} from "../utils/codeCryptoUtils";

export class DbCode {
    codeEncrypted: string;
    codeHashed: string;
    lastFour: string;

    constructor(plaintextCode: string, auth: AuthorizationBadge) {
        this.codeEncrypted = encryptCode(plaintextCode);
        this.codeHashed = computeCodeLookupHash(plaintextCode, auth);
        this.lastFour = getCodeLastFourNoPrefix(plaintextCode);
    }
}

/**
 * Done this way to support unicode and emoji characters. Length of emoji characters is often 2.
 */
export function getCodeLastFourNoPrefix(code: string) {
    return Array.from(code).slice(-4).join("");
}
