import {GenerateCodeParameters} from "../model/GenerateCodeParameters";
import * as crypto from "crypto";

const CHAR_SETS = {
    alphanumeric: "ABCDEFGHIJKLMNPQRSTUVWXYZ123456789",
    numeric: "0123456789",
    alphabetic: "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
};

/**
 * @param {GenerateCodeParameters} params
 *
 * charset: Always Capitalized.
 * - alphanumeric - [0-9 A-Z] Omitting 0 and O
 * - alphabetic - [A-Z]
 * - numeric - [0-9]
 * - custom - any given characters
 * length:
 *  - the length of the generated code. does not include prefix or suffix.
 * prefix + suffix: self explanatory.
 *
 * @returns {string}
 */
export function generateCode(params: GenerateCodeParameters): string {
    let options = {
        length: params.length,
        charset: params.charset ? params.charset : CHAR_SETS.alphanumeric
    };

    let charset: string;
    if (options.charset in CHAR_SETS) {
        charset = CHAR_SETS[options.charset];
    } else {
        charset = options.charset;
    }

    return (params.prefix ? params.prefix : "") + generateRandomString(options.length, charset) + (params.suffix ? params.suffix : "");
}

function generateRandomString(length: number, charset: string) {
    const randomBytes = crypto.randomBytes(length);
    let randomString: string = "";
    for (let i = 0; i < length; i++) {
        randomString += charset[randomBytes[i] % charset.length];
    }
    return randomString
}