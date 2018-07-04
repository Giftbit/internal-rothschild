import {AuthorizationBadge} from "giftbit-cassava-routes/dist/jwtauth";
import {computeCodeLookupHash, encryptCode} from "../utils/codeCryptoUtils";

export class DbCode {
    codeEncrypted: string;
    codeHashed: string;
    lastFour: string;
    genericCode: boolean;

    constructor(plaintextCode: string, genericCode: boolean, auth: AuthorizationBadge) {
        this.codeEncrypted = encryptCode(plaintextCode);
        this.codeHashed = computeCodeLookupHash(plaintextCode, auth);
        this.lastFour = codeLastFour(plaintextCode);
        this.genericCode = genericCode;
    }
}

export function codeLastFour(code: string) {
    const lengthForLastFour = Math.min(code.length, 4);
    return "…".concat(code.substring(code.length - lengthForLastFour));

}
