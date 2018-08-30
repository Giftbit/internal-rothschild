/**
 * Implementation of Heap's Algorithm (https://en.wikipedia.org/wiki/Heap%27s_algorithm)
 *
 * IDEA: turn this into a generator function to save on memory usage
 */
export function listPermutations<T>(input: T[]): T[][] {
    let result: T[][] = [];
    let c: number[] = [];
    const n = input.length;
    for (let i = 0; i < n; i++) {
        c[i] = 0;
    }

    result.push(copy(input));

    let i = 0;
    while (i < n) {
        if (c[i] < i) {
            if (i % 2 === 0) {
                swap(input, 0, i);
            } else {
                swap(input, c[i], i);
            }
            result.push(copy(input));
            c[i] += 1;
            i = 0;
        } else {
            c[i] = 0;
            i += 1;
        }
    }
    return result;
}

function swap(input: any[], indexOne: number, indexTwo: number): void {
    const temp: any = input[indexOne];
    input[indexOne] = input[indexTwo];
    input[indexTwo] = temp;
}

function copy<T>(input: T): T {
    return JSON.parse(JSON.stringify(input));
}
