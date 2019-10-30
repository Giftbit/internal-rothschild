import * as chai from "chai";
import {diffUtils} from "./diffUtils";

describe("diffUtils", () => {
    describe("shallowDiffObject()", () => {
        it("returns things from left that are different on right", () => {
            const left = {
                a: "alpha",
                b: "bravo",
                c: "charlie",
                d: "delta"
            };
            const right = {
                a: "alpha",
                b: "beta",
                c: "charlie",
                e: "echo"
            };
            const diff = diffUtils.shallowDiffObject(left, right as any);
            chai.assert.deepEqual(diff, {b: "bravo", d: "delta"});
        });
    });
});
