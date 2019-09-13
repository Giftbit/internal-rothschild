/**
 * Returns a filtered copy of `obj` with only the given keys present.
 */
export function pick<T>(obj: T, ...keys: (keyof T)[]): Partial<T> {
    // Based on https://github.com/jonschlinkert/object.pick/blob/master/index.js
    const res: Partial<T> = {};

    const len = keys.length;
    let idx = -1;

    while (++idx < len) {
        const key = keys[idx];
        if (key in obj) {
            res[key] = obj[key];
        }
    }
    return res;
}

export function pickOrDefault<T>(obj: Partial<T>, defaults: T): T {
    const res: Partial<T> = {};
    const keys = Object.keys(defaults);

    const len = keys.length;
    let idx = -1;

    while (++idx < len) {
        const key = keys[idx];
        if (key in obj) {
            res[key] = obj[key];
        } else {
            res[key] = defaults[key];
        }
    }
    return res as T;
}

/**
 * Returns a filtered copy of `obj` with only defined values present.
 */
export function pickDefined<T>(obj: Partial<T>): Partial<T> {
    const res: Partial<T> = {};
    const keys = Object.keys(obj);

    const len = keys.length;
    let idx = -1;

    while (++idx < len) {
        const key = keys[idx];
        if (obj[key] !== undefined) {
            res[key] = obj[key];
        }
    }
    return res;
}

/**
 * Returns a filtered copy of `obj` with only not null values present.
 */
export function pickNotNull<T>(obj: Partial<T>): Partial<T> {
    const res: Partial<T> = {};
    const keys = Object.keys(obj);

    const len = keys.length;
    let idx = -1;

    while (++idx < len) {
        const key = keys[idx];
        if (obj[key] !== null) {
            res[key] = obj[key];
        }
    }
    return res;
}