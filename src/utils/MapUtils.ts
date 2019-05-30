export namespace MapUtils {

    /**
     * Example usage:
     * const obj = {
     *   prop1: "abc",
     *   nested: {prop2: "c"}
     * }
     *
     * get(obj, "nested.prop2")
     */
    export function get(obj: object, path: string): any {
        let current = obj;
        const paths = path.split('.');
        while (paths.length) {
            if (typeof current !== 'object') {
                return undefined;
            }
            current = current[paths.shift()];
        }
        return current;
    }

    /**
     * Example usage:
     * const obj = {
     *   prop1: "abc",
     *   nested: {prop2: "c"}
     * }
     *
     * set(obj, "nested.prop2", "d")
     */
    export function set(obj: object, path: string, value: any): object {
        let objClone = {...obj}; // avoids mutating obj
        let current = objClone;  // a moving reference to internal objects within obj
        const paths = path.split('.');
        while (paths.length > 1) {
            current = current[paths.shift()] || {};
        }
        current[paths[0] /* paths is a single element array at this point */] = value;
        return objClone;
    }
}