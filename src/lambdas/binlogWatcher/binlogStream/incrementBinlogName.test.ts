import * as chai from "chai";
import {incrementBinlogName} from "./incrementBinlogName";

describe("incrementBinlogName()", () => {
    it("increments the suffix to find the next consecutive file", () => {
        const output = incrementBinlogName("mysql-bin-changelog.000020");
        chai.assert.equal(output, "mysql-bin-changelog.000021", "it's not rocket surgery");
    });
});
