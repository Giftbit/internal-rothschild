/**
 * Tests whether the given string only contains valid
 * system ID characters.
 */
export function isSystemId(id: string): boolean {
    return isSystemId.regex.test(id);
}

export namespace isSystemId {
    export const regex = /^[!-~]+([ -~]*[!-~]+)?$/;
    export const regexString = "^[!-~]+([ -~]*[!-~]+)?$";
}
