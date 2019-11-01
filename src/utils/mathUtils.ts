export namespace MathUtils {
    export function constrain(min: number, value: number, max: number): number {
        if (min > max) {
            throw new Error(`Min=${min} must be less than or equal max=${max}.`);
        }
        return Math.min(max, Math.max(min, value))
    }
}