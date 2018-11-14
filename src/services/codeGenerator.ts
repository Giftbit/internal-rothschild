import {GenerateCodeParameters} from "../model/GenerateCodeParameters";
import * as crypto from "crypto";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as cassava from "cassava";

const ALPHANUMBERIC_CHARSET = Array.from("ABCDEFGHJKLMNPQRSTUVWXYZ23456789");
const DEFAULT_LENGTH = 16;
const WHITESPACE_MATCHER = /\s/;

/**
 * @param {GenerateCodeParameters} params
 *
 * charset: Always Capitalized.
 *  - characters to be randomized from.
 *  - will default to alphanumeric if non provided
 * length:
 *  - the length of the generated code. does not include prefix or suffix.
 * prefix + suffix: self explanatory.
 *
 * @returns {string}
 */
export function generateCode(params: GenerateCodeParameters): string {
    const length = params.length ? params.length : DEFAULT_LENGTH;
    const charset = params.charset ? Array.from(params.charset) : ALPHANUMBERIC_CHARSET;

    if (containsDuplicates(charset)) {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Requested charset ${charset.join("")} contains duplicates.`, "InvalidGenerateCodeParameters");
    }
    if (charset.length < 5) {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Requested charset ${charset.join("")} doesn't meet minimum charset size requirement of 5.`, "InvalidGenerateCodeParameters");
    }
    if (charset.find(c => WHITESPACE_MATCHER.test(c))) {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Requested charset ${charset.join("")} cannot contain whitespace.`, "InvalidGenerateCodeParameters");
    }
    if (length < 6) {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Requested code length ${length} doesn't meet minimum requirement of 6.`, "InvalidGenerateCodeParameters");
    }

    return (params.prefix ? params.prefix : "") + generateRandomString(length, charset) + (params.suffix ? params.suffix : "");
}

function generateRandomString(length: number, charset: string[]) {
    const randomBytes = crypto.randomBytes(length);
    let randomString: string = "";
    for (let i = 0; i < length; i++) {
        randomString += charset[randomBytes[i] % charset.length];
    }
    return randomString;
}

export function containsDuplicates(str: string[]) {
    const hash = new Map();

    for (const char of str) {
        if (hash.get(char) === undefined) {
            hash.set(char, true);
        } else {
            return true;
        }
    }
    return false;
}
