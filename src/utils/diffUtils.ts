export namespace diffUtils {

    /**
     * Get the values from `left` that are different from `right`.
     * Values that are in `left` but not `right` are included.
     * Values that are in `right` but not `left` are *not* included.
     */
    export function shallowDiffObject<T>(left: T, right: T): Partial<T> {
        // When Object.entries and Object.fromEntries are available there's a nicer,
        // functional way to do this.
        const res: Partial<T> = {};
        Object.keys(left)
            .forEach(key => {
                if (left[key] !== right[key]) {
                    res[key] = left[key];
                }
            });
        return res;
    }
}
