import {AuthorizationBadge} from "giftbit-cassava-routes/dist/jwtauth";
import {computeCodeLookupHash, encryptCode} from "../utils/codeCryptoUtils";

export interface DbCode {
    codeEncrypted: string;
    codeHashed: string;
    lastFour: string;
}

export namespace DbCode {
    export async function getDbCode(plaintextCode: string, auth: AuthorizationBadge): Promise<DbCode> {
        return {
            codeEncrypted: await encryptCode(plaintextCode),
            codeHashed: await computeCodeLookupHash(plaintextCode, auth),
            lastFour: await getCodeLastFourNoPrefix(plaintextCode)
        };
    }
}

/**
 * Done this way to support unicode and emoji characters. Length of emoji characters is often 2.
 */
export function getCodeLastFourNoPrefix(code: string) {
    return Array.from(code).slice(-4).join("");
}
