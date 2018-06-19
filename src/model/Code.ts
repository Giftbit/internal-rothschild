import {computeLookupHash, encrypt} from "../services/codeCryptoUtils";
import {AuthorizationBadge} from "giftbit-cassava-routes/dist/jwtauth";

export interface PublicCode {
    codeHashed: string;
}

export interface SecureCode extends PublicCode {
    encryptedCode: string;
}

export type Code = PublicCode | SecureCode;

export function constructSecureCode(plaintextCode: string, auth: AuthorizationBadge): SecureCode {
    return {
        encryptedCode: encrypt(plaintextCode),
        codeHashed: computeLookupHash(plaintextCode, auth)
    }
}

export function constructPublicCode(plaintextCode: string, auth: AuthorizationBadge): PublicCode {
    return {
        codeHashed: computeLookupHash(plaintextCode, auth)
    }
}

