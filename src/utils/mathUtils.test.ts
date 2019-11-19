import * as chai from "chai";
import {MathUtils} from "./mathUtils";

describe("mathUtils", () => {
    describe("constrain", () => {
        it("returns value if min < value < max", () => {
            chai.assert.equal(MathUtils.constrain(0, 0.5, 1), 0.5);
        });

        it("returns min if value == min", () => {
            chai.assert.equal(MathUtils.constrain(0, 0, 1), 0);
        });

        it("returns min if value < min", () => {
            chai.assert.equal(MathUtils.constrain(0, -1, 1), 0);
        });

        it("returns max if value == max", () => {
            chai.assert.equal(MathUtils.constrain(0, 1, 1), 1);
        });

        it("returns max if value > max", () => {
            chai.assert.equal(MathUtils.constrain(0, 2, 1), 1);
        });

        it("throws error if min > max", () => {
            chai.assert.throws(() => {
                MathUtils.constrain(2, 1, 1);
            }, "Min=2 must be less than or equal max=1");
        });
    });
});