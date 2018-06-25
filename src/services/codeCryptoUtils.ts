import * as cryptojs from "crypto-js";
import {AuthorizationBadge} from "giftbit-cassava-routes/dist/jwtauth";

const encryptionSecret = "ca7589aef4ffed15783341414fe2f4a5edf9ddad75cf2e96ed2a16aee88673ea"; // todo - this needs to be put in config. Needs to be generated and should be 256 bits = 32 bytes
const lookupHashSecret = "ca7589aef4ffed15783341414fe2f4a5edf9ddad75cf2e96ed2a16aee88673ea"; // todo - this needs to be put in config. Needs to be generated and should be 256 bits = 32 bytes
// const encryptionSecret = "correcthorsebatterystapleswindle"; // todo - this needs to be put in config. Needs to be generated and should be 256 bits = 32 bytes
// const lookupHashSecret = "potatotrunkelevatorllambawinders"; // todo - this needs to be put in config. Needs to be generated and should be 256 bits = 32 bytes
const CODEBASE_ENCRYPTION_PEPPER = "5aa348b6ff321a5b6b7701b7da0cc2dc";

/**
 * The resulting encrypted value does not need to be unique in the database.
 * This is why the userId is not appended to the code value.
 */
export function encrypt(code: string): string {
    return cryptojs.AES.encrypt(addCodebasePepperToCode(code), encryptionSecret).toString();
}

export function decrypt(encryptedCode: string): string {
    const bytes = cryptojs.AES.decrypt(encryptedCode.toString(), encryptionSecret);
    const decryptedCodeWithCodebasePepper = bytes.toString(cryptojs.enc.Utf8);
    return removeCodebasePepperFromDecryptedCode(decryptedCodeWithCodebasePepper);
}

export function computeLookupHash(code: string, badge: AuthorizationBadge) {
    return cryptojs.SHA512(code + badge.giftbitUserId + lookupHashSecret).toString();
}

/**
 * IMPORTANT: This is used so that if the AWS account is compromised
 * the codes can't be decrypted without access to the codebase.
 * todo - this shouldn't be exported. need a better way to test. going to wait to decide if we want this to be a thing or not though before doing that.
 */
export function addCodebasePepperToCode(code: string) {
    return code + CODEBASE_ENCRYPTION_PEPPER;
}

export function removeCodebasePepperFromDecryptedCode(decryptedCode: string) {
    return decryptedCode.replace(CODEBASE_ENCRYPTION_PEPPER, "");
}

// temporary. remove after we've generated the key.
export function generateKey() {
    const secretPassphrase = cryptojs.lib.WordArray.random();
    const salt = cryptojs.lib.WordArray.random(128 / 8);
    const key128Bits = cryptojs.PBKDF2(secretPassphrase, salt, {keySize: 128 / 32});
    const key256Bits = cryptojs.PBKDF2(secretPassphrase, salt, {keySize: 256 / 32});
    console.log("128bit key: " + key128Bits);
    console.log("256bit key: " + key256Bits);
}