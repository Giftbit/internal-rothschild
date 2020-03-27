import Checkpoint = BinlogWatcherState.Checkpoint;

export interface BinlogWatcherState {
    /**
     * A database of one row.  DynamoDB doesn't care.  DynamoDB is cool.
     */
    id: "BinlogWatcherState";

    /**
     * The last binlog file and position that was successfully published.
     */
    checkpoint: Checkpoint | null;

    /**
     * The last time the binlog was flushed.  In ISO format.
     */
    flushBinlogDate?: string;

    /**
     * Track version of the state to prevent bad overwriting.  This is managed automatically
     * by Dynameh.
     */
    version?: number;
}

export namespace BinlogWatcherState {
    export interface Checkpoint {
        /**
         * The name of the last binlog file that was processed successfully.  This increases
         * monotonically.  bin.000001, bin.000002, etc...
         */
        binlogName: string;

        /**
         * The byte of the last binlog entry in the file that was processed successfully.  This
         * increases monotonically until it is reset for the next file with a Rotate event.
         */
        binlogPosition: number;
    }

    export namespace Checkpoint {
        export function compare(a: Checkpoint, b: Checkpoint): number {
            if (a.binlogName < b.binlogName) {
                return -1;
            } else if (a.binlogName > b.binlogName) {
                return 1;
            } else {
                return a.binlogPosition - b.binlogPosition;
            }
        }
    }
}
