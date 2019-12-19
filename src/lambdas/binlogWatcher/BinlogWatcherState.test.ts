import * as chai from "chai";
import {BinlogWatcherState} from "./BinlogWatcherState";

describe("BinlogWatcherState", () => {
    describe("Checkpoint", () => {
        describe("compare()", () => {
            it("returns 0 if a == b", () => {
                const a: BinlogWatcherState.Checkpoint = {
                    binlogName: "bin.000001",
                    binlogPosition: 0
                };
                const b: BinlogWatcherState.Checkpoint = {
                    ...a
                };
                chai.assert.equal(BinlogWatcherState.Checkpoint.compare(a, b), 0);
            });

            it("returns < 0 if a.binlogName < b.binlogName", () => {
                const a: BinlogWatcherState.Checkpoint = {
                    binlogName: "bin.000001",
                    binlogPosition: 1200
                };
                const b: BinlogWatcherState.Checkpoint = {
                    binlogName: "bin.000002",
                    binlogPosition: 100
                };
                chai.assert.isBelow(BinlogWatcherState.Checkpoint.compare(a, b), 0);
            });

            it("returns < 0 if a.binlogName == b.binlogName && a.binlogPosition < b.binlogPosition", () => {
                const a: BinlogWatcherState.Checkpoint = {
                    binlogName: "bin.000001",
                    binlogPosition: 1200
                };
                const b: BinlogWatcherState.Checkpoint = {
                    binlogName: "bin.000002",
                    binlogPosition: 1400
                };
                chai.assert.isBelow(BinlogWatcherState.Checkpoint.compare(a, b), 0);
            });

            it("returns > 0 if a.binlogName > b.binlogName", () => {
                const a: BinlogWatcherState.Checkpoint = {
                    binlogName: "bin.000003",
                    binlogPosition: 1200
                };
                const b: BinlogWatcherState.Checkpoint = {
                    binlogName: "bin.000002",
                    binlogPosition: 1400
                };
                chai.assert.isAbove(BinlogWatcherState.Checkpoint.compare(a, b), 0);
            });

            it("returns > 0 if a.binlogName == b.binlogName && a.binlogPosition > b.binlogPosition", () => {
                const a: BinlogWatcherState.Checkpoint = {
                    binlogName: "bin.000002",
                    binlogPosition: 1200
                };
                const b: BinlogWatcherState.Checkpoint = {
                    binlogName: "bin.000002",
                    binlogPosition: 1400
                };
                chai.assert.isAbove(BinlogWatcherState.Checkpoint.compare(a, b), 0);
            });
        });
    });
});
