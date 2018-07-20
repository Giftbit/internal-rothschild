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
    // console.log("obj " + JSON.stringify(obj, null, 4));
    // console.log("defaults " + JSON.stringify(defaults, null, 4));
    const res: Partial<T> = {};
    const keys = Object.keys(defaults);

    const len = keys.length;
    let idx = -1;

    while (++idx < len) {
        const key = keys[idx];
        // console.log("key " + key);
        if (key in obj) {
            // console.log("key in obj. value: " + obj[key]);
            res[key] = obj[key];
        } else {
            res[key] = defaults[key];
            // console.log("key in obj. value: " + obj[key]);
        }
    }
    // console.log("res " + JSON.stringify(res));
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
 * Returns a filtered copy of `obj` with only non-null values present.
 */
export function pickNonNull<T>(obj: Partial<T>): Partial<T> {
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
