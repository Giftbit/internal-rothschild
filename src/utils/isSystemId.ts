/**
 * Tests whether the given string is a legal system ID.
 */
export function isSystemId(id: string): boolean {
    return isSystemId.regex.test(id);
}

export namespace isSystemId {
    export const regex = /^[ -~]*$/;
    export const regexString = "^[ -~]*$";
}
