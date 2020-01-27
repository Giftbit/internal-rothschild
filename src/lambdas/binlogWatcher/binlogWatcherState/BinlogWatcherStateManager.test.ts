import * as chai from "chai";
import {BinlogWatcherStateManager} from "./BinlogWatcherStateManager";

describe("BinlogWatcherStateManager", () => {
    it("does not store the checkpoint until it is closed", () => {
        const manager = new BinlogWatcherStateManager();
        manager.state = {
            id: "BinlogWatcherState",
            checkpoint: null
        };

        manager.openCheckpoint("bin.000000", 123456);
        chai.assert.isNull(manager.state.checkpoint);
    });

    it("stores the checkpoint when the previous checkpoint is null", () => {
        const manager = new BinlogWatcherStateManager();
        manager.state = {
            id: "BinlogWatcherState",
            checkpoint: null
        };

        manager.openCheckpoint("bin.000000", 123456);
        chai.assert.isNull(manager.state.checkpoint);

        manager.closeCheckpoint("bin.000000", 123456);
        chai.assert.isNotNull(manager.state.checkpoint);
        chai.assert.deepEqual(manager.state.checkpoint, {
            binlogName: "bin.000000",
            binlogPosition: 123456
        });
    });

    it("stores the checkpoint when the previous checkpoint is an earlier file", () => {
        const manager = new BinlogWatcherStateManager();
        manager.state = {
            id: "BinlogWatcherState",
            checkpoint: {
                binlogName: "bin.000000",
                binlogPosition: 123456
            }
        };

        manager.openCheckpoint("bin.000001", 12);
        chai.assert.deepEqual(manager.state.checkpoint, {
            binlogName: "bin.000000",
            binlogPosition: 123456
        });

        manager.closeCheckpoint("bin.000001", 12);
        chai.assert.isNotNull(manager.state.checkpoint);
        chai.assert.deepEqual(manager.state.checkpoint, {
            binlogName: "bin.000001",
            binlogPosition: 12
        });
    });

    it("stores the checkpoint when the previous checkpoint is the same file in an earlier position", () => {
        const manager = new BinlogWatcherStateManager();
        manager.state = {
            id: "BinlogWatcherState",
            checkpoint: {
                binlogName: "bin.000001",
                binlogPosition: 12
            }
        };

        manager.openCheckpoint("bin.000001", 986);
        chai.assert.deepEqual(manager.state.checkpoint, {
            binlogName: "bin.000001",
            binlogPosition: 12
        });

        manager.closeCheckpoint("bin.000001", 986);
        chai.assert.isNotNull(manager.state.checkpoint);
        chai.assert.deepEqual(manager.state.checkpoint, {
            binlogName: "bin.000001",
            binlogPosition: 986
        });
    });

    it("does not store the checkpoint until any earlier open checkpoints are closed", () => {
        const manager = new BinlogWatcherStateManager();
        manager.state = {
            id: "BinlogWatcherState",
            checkpoint: {
                binlogName: "bin.000001",
                binlogPosition: 986
            }
        };

        manager.openCheckpoint("bin.000001", 2048);
        chai.assert.deepEqual(manager.state.checkpoint, {
            binlogName: "bin.000001",
            binlogPosition: 986
        });

        manager.openCheckpoint("bin.000001", 3062);
        chai.assert.deepEqual(manager.state.checkpoint, {
            binlogName: "bin.000001",
            binlogPosition: 986
        });

        manager.closeCheckpoint("bin.000001", 3062);
        chai.assert.deepEqual(manager.state.checkpoint, {
            binlogName: "bin.000001",
            binlogPosition: 986
        });

        manager.closeCheckpoint("bin.000001", 2048);
        chai.assert.deepEqual(manager.state.checkpoint, {
            binlogName: "bin.000001",
            binlogPosition: 3062
        });
    });

    it("does not store the checkpoint until any equal checkpoint is closed", () => {
        const manager = new BinlogWatcherStateManager();
        manager.state = {
            id: "BinlogWatcherState",
            checkpoint: {
                binlogName: "bin.000001",
                binlogPosition: 3062
            }
        };

        manager.openCheckpoint("bin.000001", 4086);
        chai.assert.deepEqual(manager.state.checkpoint, {
            binlogName: "bin.000001",
            binlogPosition: 3062
        });

        manager.openCheckpoint("bin.000001", 4086);
        chai.assert.deepEqual(manager.state.checkpoint, {
            binlogName: "bin.000001",
            binlogPosition: 3062
        });

        manager.closeCheckpoint("bin.000001", 4086);
        chai.assert.deepEqual(manager.state.checkpoint, {
            binlogName: "bin.000001",
            binlogPosition: 3062
        });

        manager.openCheckpoint("bin.000001", 5110);
        chai.assert.deepEqual(manager.state.checkpoint, {
            binlogName: "bin.000001",
            binlogPosition: 3062
        });

        manager.closeCheckpoint("bin.000001", 4086);
        chai.assert.deepEqual(manager.state.checkpoint, {
            binlogName: "bin.000001",
            binlogPosition: 4086
        });
    });

    it("throws an error when opening a checkpoint before the current state", () => {
        const manager = new BinlogWatcherStateManager();
        manager.state = {
            id: "BinlogWatcherState",
            checkpoint: {
                binlogName: "bin.000001",
                binlogPosition: 4086
            }
        };

        chai.assert.throws(() => {
            manager.openCheckpoint("bin.000001", 256);
        });
    });

    it("throws an error when closing a checkpoint that wasn't opened", () => {
        const manager = new BinlogWatcherStateManager();
        manager.state = {
            id: "BinlogWatcherState",
            checkpoint: {
                binlogName: "bin.000001",
                binlogPosition: 256
            }
        };

        chai.assert.throws(() => {
            manager.closeCheckpoint("bin.000001", 367);
        });
    });
});
