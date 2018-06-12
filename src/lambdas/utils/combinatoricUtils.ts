/**
 * Implementation of Heap's Algorithm (https://en.wikipedia.org/wiki/Heap%27s_algorithm)
 */
export function listPermutations(input: Array<any>): Array<Array<any>> {
    let result: Array<Array<any>> = [];
    let c: Array<number> = [];
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
    return result
}

function swap(input: Array<any>, indexOne: number, indexTwo: number): void {
    const temp: any = input[indexOne];
    input[indexOne] = input[indexTwo];
    input[indexTwo] = temp;
}

function copy(input: any): any {
    return JSON.parse(JSON.stringify(input));
}