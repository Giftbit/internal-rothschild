import * as cryptojs from "crypto-js";
import {AuthorizationBadge} from "giftbit-cassava-routes/dist/jwtauth";

const CODEBASE_ENCRYPTION_PEPPER = "5aa348b6ff321a5b6b7701b7da0cc2dc";

let codeCryptographySecrets: CodeCryptographySecrets;

export async function initializeCodeCryptographySecrets(secrets: Promise<CodeCryptographySecrets>): Promise<void> {
    codeCryptographySecrets = await secrets;
}

/**
 * The resulting encrypted value does not need to be unique in the database.
 * This is why the userId is not appended to the code value.
 */
export function encryptCode(code: string): string {
    if (!codeCryptographySecrets) {
        throw "Code cryptography secrets have not been initialized.";
    }
    return cryptojs.AES.encrypt(addCodebasePepperToCode(code), codeCryptographySecrets.encryptionSecret).toString();
}

export function decryptCode(codeEncrypted: string): string {
    if (!codeCryptographySecrets) {
        throw "Code cryptography secrets have not been initialized.";
    }
    const bytes = cryptojs.AES.decrypt(codeEncrypted.toString(), codeCryptographySecrets.encryptionSecret);
    const decryptedCodeWithCodebasePepper = bytes.toString(cryptojs.enc.Utf8);
    return removeCodebasePepperFromDecryptedCode(decryptedCodeWithCodebasePepper);
}

export function computeCodeLookupHash(code: string, badge: AuthorizationBadge): string {
    if (!codeCryptographySecrets) {
        throw "Code cryptography secrets have not been initialized.";
    }
    return cryptojs.SHA512(code + badge.userId + codeCryptographySecrets.lookupHashSecret).toString();
}

/**
 * IMPORTANT: This is used so that if the AWS account is compromised
 * the codes can't be decrypted without access to the codebase.
 */
export function addCodebasePepperToCode(code: string): string {
    return code + CODEBASE_ENCRYPTION_PEPPER;
}

export function removeCodebasePepperFromDecryptedCode(decryptedCode: string) {
    return decryptedCode.replace(CODEBASE_ENCRYPTION_PEPPER, "");
}

export function getIntercomSecret(): string {
    return "8Hukl21alPrTFcHjeNx3tn0BmzyB1O8-zE2c7rqQ";
}

export interface CodeCryptographySecrets {
    encryptionSecret: string;
    lookupHashSecret: string;
}
