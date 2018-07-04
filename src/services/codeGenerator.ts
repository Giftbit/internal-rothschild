import {GenerateCodeParameters} from "../model/GenerateCodeParameters";
import * as crypto from "crypto";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as cassava from "cassava";

const ALPHANUMBERIC_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

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
    let options = {
        length: params.length,
        charset: params.charset ? params.charset : ALPHANUMBERIC_CHARSET
    };

    if (containsDuplicates(options.charset)) {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Requested charset ${options.charset} contains duplicates.`, "ValueInUse");
    }
    if (options.charset.length < 5) {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Requested charset ${options.charset} doesn't meet minimum charset size requirement of 5.`, "ValueInUse");
    }
    if (options.length < 6) {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Requested code length ${options.length} doesn't meet minimum requirement of 6.`, "ValueInUse");
    }

    let charset: string;

    return (params.prefix ? params.prefix : "") + generateRandomString(options.length, options.charset) + (params.suffix ? params.suffix : "");
}

function generateRandomString(length: number, charset: string) {
    const randomBytes = crypto.randomBytes(length);
    let randomString: string = "";
    for (let i = 0; i < length; i++) {
        randomString += charset[randomBytes[i] % charset.length];
    }
    return randomString
}

export function containsDuplicates(str: string) {
    const arr = str.split('');
    const hash = new Map();

    for (let char of str) {
        if (hash.get(char) === undefined) {
            hash.set(char, true);
        } else {
            return true;
        }
    }
    for (let i = 0; i < arr.length; i++) {
    }
    return false;
}