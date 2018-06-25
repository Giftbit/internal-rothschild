import {GenerateCodeParameters} from "../model/GenerateCodeParameters";
import * as randomstring from "randomstring";

/**
 * @param {GenerateCodeParameters} params
 *
 * charset: Always Capitalized.
 * - alphanumeric - [0-9 A-Z]
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
        charset: params.charset ? params.charset : "alphanumeric",
        capitalization: "uppercase",
        readable: true
    };
    return (params.prefix ? params.prefix : "") + randomstring.generate(options) + (params.suffix ? params.suffix : "");
}