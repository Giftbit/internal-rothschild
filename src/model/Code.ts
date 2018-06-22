import {computeLookupHash, encrypt} from "../services/codeCryptoUtils";
import {AuthorizationBadge} from "giftbit-cassava-routes/dist/jwtauth";

export interface Code {
    encryptedCode: string;
    codeHashed: string;
    genericCode: boolean;
}

export function constructCode(plaintextCode: string, genericCode: boolean, auth: AuthorizationBadge): Code {
    return {
        encryptedCode: encrypt(plaintextCode),
        codeHashed: computeLookupHash(plaintextCode, auth),
        genericCode: genericCode
    }
}

