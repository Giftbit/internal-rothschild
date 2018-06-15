import * as chai from "chai";
import {listPermutations} from "./combinatoricUtils";

describe("combinatoricUtils tests", () => {

    it("test perms on 0 primitive objects", async () => {
        const result = listPermutations([]);
        chai.assert.deepEqual(result, [[]]);
    });

    it("test perms on 1 primitive object", async () => {
        const result = listPermutations(["A"]);
        chai.assert.deepEqual(result, [["A"]]);
    });

    it("test perms on 2 primitive objects", async () => {
        const result = listPermutations(["A", "B"]);
        chai.assert.deepEqual(result, [["A", "B"], ["B", "A"]]);
    });

    it("test perms on 2 primitive objects", async () => {
        const result = listPermutations(["A", "B", "C"]);
        chai.assert.deepEqual(result, [["A", "B", "C"], ["B", "A", "C"], ["C", "A", "B"], ["A", "C", "B"], ["B", "C", "A"], ["C", "B", "A"]]);
    });

    it("test perms on 2 primitive objects", async () => {
        const result = listPermutations(["A", "B", "C", "D"]);
        chai.assert.deepEqual(result, [["A", "B", "C", "D"], ["B", "A", "C", "D"], ["C", "A", "B", "D"], ["A", "C", "B", "D"], ["B", "C", "A", "D"], ["C", "B", "A", "D"], ["D", "B", "A", "C"], ["B", "D", "A", "C"], ["A", "D", "B", "C"], ["D", "A", "B", "C"], ["B", "A", "D", "C"], ["A", "B", "D", "C"], ["A", "C", "D", "B"], ["C", "A", "D", "B"], ["D", "A", "C", "B"], ["A", "D", "C", "B"], ["C", "D", "A", "B"], ["D", "C", "A", "B"], ["D", "C", "B", "A"], ["C", "D", "B", "A"], ["B", "D", "C", "A"], ["D", "B", "C", "A"], ["C", "B", "D", "A"], ["B", "C", "D", "A"]]);
    });

    let objectA = {
        name: "a"
    };
    let objectB = {
        name: "b"
    };
    let objectC = {
        name: "c"
    };
    let objectD = {
        name: "d"
    };

    it("test perms on 1 object", async () => {
        const result = listPermutations([objectA]);
        chai.assert.deepEqual(result, [[{"name": "a"}]]);
    });

    it("test perms on 2 objects", async () => {
        const result = listPermutations([objectA, objectB]);
        chai.assert.deepEqual(result,
            [[{"name": "a"}, {"name": "b"}], [{"name": "b"}, {"name": "a"}]]);
    });

    it("test perms on 3 objects", async () => {
        const result = listPermutations([objectA, objectB, objectC]);
        chai.assert.deepEqual(result,
            [[{"name": "a"}, {"name": "b"}, {"name": "c"}], [{"name": "b"}, {"name": "a"}, {"name": "c"}], [{"name": "c"}, {"name": "a"}, {"name": "b"}], [{"name": "a"}, {"name": "c"}, {"name": "b"}], [{"name": "b"}, {"name": "c"}, {"name": "a"}], [{"name": "c"}, {"name": "b"}, {"name": "a"}]]);
    });

    it("test perms on 4 objects", async () => {
        const result = listPermutations([objectA, objectB, objectC, objectD]);
        chai.assert.deepEqual(result,
            [[{"name": "a"}, {"name": "b"}, {"name": "c"}, {"name": "d"}], [{"name": "b"}, {"name": "a"}, {"name": "c"}, {"name": "d"}], [{"name": "c"}, {"name": "a"}, {"name": "b"}, {"name": "d"}], [{"name": "a"}, {"name": "c"}, {"name": "b"}, {"name": "d"}], [{"name": "b"}, {"name": "c"}, {"name": "a"}, {"name": "d"}], [{"name": "c"}, {"name": "b"}, {"name": "a"}, {"name": "d"}], [{"name": "d"}, {"name": "b"}, {"name": "a"}, {"name": "c"}], [{"name": "b"}, {"name": "d"}, {"name": "a"}, {"name": "c"}], [{"name": "a"}, {"name": "d"}, {"name": "b"}, {"name": "c"}], [{"name": "d"}, {"name": "a"}, {"name": "b"}, {"name": "c"}], [{"name": "b"}, {"name": "a"}, {"name": "d"}, {"name": "c"}], [{"name": "a"}, {"name": "b"}, {"name": "d"}, {"name": "c"}], [{"name": "a"}, {"name": "c"}, {"name": "d"}, {"name": "b"}], [{"name": "c"}, {"name": "a"}, {"name": "d"}, {"name": "b"}], [{"name": "d"}, {"name": "a"}, {"name": "c"}, {"name": "b"}], [{"name": "a"}, {"name": "d"}, {"name": "c"}, {"name": "b"}], [{"name": "c"}, {"name": "d"}, {"name": "a"}, {"name": "b"}], [{"name": "d"}, {"name": "c"}, {"name": "a"}, {"name": "b"}], [{"name": "d"}, {"name": "c"}, {"name": "b"}, {"name": "a"}], [{"name": "c"}, {"name": "d"}, {"name": "b"}, {"name": "a"}], [{"name": "b"}, {"name": "d"}, {"name": "c"}, {"name": "a"}], [{"name": "d"}, {"name": "b"}, {"name": "c"}, {"name": "a"}], [{"name": "c"}, {"name": "b"}, {"name": "d"}, {"name": "a"}], [{"name": "b"}, {"name": "c"}, {"name": "d"}, {"name": "a"}]]);
    });

    it("test permutations on complex object", async () => {
        let complexA = {
            name: "complexA",
            metadata: {
                value: "a"
            }
        };
        let complexB = {
            name: "complexB",
            metadata: {
                value: "b"
            }
        };
        const result = listPermutations([complexA, complexB]);
        chai.assert.deepEqual(result,
            [[{"name": "complexA", "metadata": {"value": "a"}}, {
                "name": "complexB",
                "metadata": {"value": "b"}
            }], [{"name": "complexB", "metadata": {"value": "b"}}, {"name": "complexA", "metadata": {"value": "a"}}]]);
    });
});