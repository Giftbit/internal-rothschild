export namespace MapUtils {

    export function get(obj: any, path: string): any {
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

    export function set(obj: any, path: string, value: any): void {
        let current = obj;  // a moving reference to internal objects within obj
        const paths = path.split('.');
        while (paths.length > 1) {
            current = current[paths.shift()] || {};
        }
        current[paths[0] /* paths is a single element array at this point */] = value;
    }
}