import * as cryptojs from "crypto-js";
import {AuthorizationBadge} from "giftbit-cassava-routes/dist/jwtauth";

const CODEBASE_ENCRYPTION_PEPPER = "5aa348b6ff321a5b6b7701b7da0cc2dc";

let codeCryptographySecrets: Promise<CodeCryptographySecrets>;

export function initializeCodeCryptographySecrets(secrets: Promise<CodeCryptographySecrets>): void {
    codeCryptographySecrets = secrets;
}

/**
 * The resulting encrypted value does not need to be unique in the database.
 * This is why the userId is not appended to the code value.
 */
export async function encryptCode(code: string): Promise<string> {
    if (!codeCryptographySecrets) {
        throw new Error("Code cryptography secrets have not been initialized.");
    }
    return cryptojs.AES.encrypt(addCodebasePepperToCode(code), (await codeCryptographySecrets).encryptionSecret).toString();
}

export async function decryptCode(codeEncrypted: string): Promise<string> {
    if (!codeCryptographySecrets) {
        throw new Error("Code cryptography secrets have not been initialized.");
    }
    const bytes = cryptojs.AES.decrypt(codeEncrypted.toString(), (await codeCryptographySecrets).encryptionSecret);
    const decryptedCodeWithCodebasePepper = bytes.toString(cryptojs.enc.Utf8);
    return removeCodebasePepperFromDecryptedCode(decryptedCodeWithCodebasePepper);
}

export async function computeCodeLookupHash(code: string, badge: AuthorizationBadge): Promise<string> {
    if (!codeCryptographySecrets) {
        throw new Error("Code cryptography secrets have not been initialized.");
    }
    return cryptojs.SHA512(code + badge.userId + (await codeCryptographySecrets).lookupHashSecret).toString();
}

/**
 * IMPORTANT: This is used so that if the AWS account is compromised
 * the codes can't be decrypted without access to the codebase.
 */
export function addCodebasePepperToCode(code: string): string {
    return code + CODEBASE_ENCRYPTION_PEPPER;
}

export function removeCodebasePepperFromDecryptedCode(decryptedCode: string): string {
    return decryptedCode.replace(CODEBASE_ENCRYPTION_PEPPER, "");
}

export interface CodeCryptographySecrets {
    encryptionSecret: string;
    lookupHashSecret: string;
}
