import {AuthorizationBadge} from "giftbit-cassava-routes/dist/jwtauth";
import {computeCodeLookupHash, encryptCode} from "../utils/codeCryptoUtils";

export class DbCode {
    codeEncrypted: string;
    codeHashed: string;
    lastFour: string;

    constructor(plaintextCode: string, genericCode: boolean, auth: AuthorizationBadge) {
        this.codeEncrypted = encryptCode(plaintextCode);
        this.codeHashed = computeCodeLookupHash(plaintextCode, auth);
        this.lastFour = codeLastFour(plaintextCode);
    }
}

export function codeLastFour(code: string) {
    console.log(code);
    let codeArray = [];
    for (let c of code) {
        codeArray.push(c);
    }
    const codeArrayReversed = codeArray.reverse();
    let lastFour = "";
    const lengthForLastFour = Math.min(codeArray.length, 4);
    for (let i = 0; i < lengthForLastFour; i++) {
        lastFour = codeArrayReversed[i] + lastFour;
    }
    return "…" + lastFour;
}
