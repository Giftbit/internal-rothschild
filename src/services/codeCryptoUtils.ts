import * as cryptojs from "crypto-js";
import {AuthorizationBadge} from "giftbit-cassava-routes/dist/jwtauth";

const encryptionSecret = "correcthorsebatterystaple"; // todo - this needs to be put in config. Needs to be generated and should be 256 bits = 32 bytes
const lookupHashSecret = "potatotrunkelevatorllamba"; // todo - this needs to be put in config. Needs to be generated and should be 256 bits = 32 bytes
const CODEBASE_ENCRYPTION_PEPPER = "5aa348b6ff321a5b6b7701b7da0cc2dc";

/**
 * The resulting encrypted value does not need to be unique in the database. This is why the giftbitUserId is not appended to the code value.
 * @param {string} code
 * @returns {string}
 */
export function encrypt(code: string): string {
    return cryptojs.AES.encrypt(addCodebasePepperToCode(code), encryptionSecret);
}

export function decrypt(encryptedCode: string): string {
    const bytes = cryptojs.AES.decrypt(encryptedCode.toString(), encryptionSecret);
    const decryptedCodeWithCodebasePepper = bytes.toString(cryptojs.enc.Utf8);
    console.log("decryptedCodeWithCodebasePepper " + decryptedCodeWithCodebasePepper);
    return removeCodebasePepperFromDecryptedCode(decryptedCodeWithCodebasePepper);
}

export function computeLookupHash(code: string, badge: AuthorizationBadge) {
    return cryptojs.SHA512(code + badge.giftbitUserId + lookupHashSecret).toString();
}

/**
 * IMPORTANT: This cannot change.
 * This is used so that if the AWS account is compromised the codes can't be decrypted without access to the codebase.
 * @returns {string}
 */
function addCodebasePepperToCode(code: string) {
    return code + CODEBASE_ENCRYPTION_PEPPER;
}

function removeCodebasePepperFromDecryptedCode(decryptedCode: string) {
    return decryptedCode.replace(CODEBASE_ENCRYPTION_PEPPER, '')
}

// todo - temporary. remove after we've generated the key.
export function generateKey() {
    const secretPassphrase = cryptojs.lib.WordArray.random();
    const salt = cryptojs.lib.WordArray.random(128 / 8);
    console.log("SALT: " + salt);
    const key128Bits = cryptojs.PBKDF2(secretPassphrase, salt, {keySize: 128 / 32});
    const key256Bits = cryptojs.PBKDF2(secretPassphrase, salt, {keySize: 256 / 32});
    console.log("128bit key: " + key128Bits);
    console.log("256bit key: " + key256Bits);
}
