export interface BinlogWatcherState {
    /**
     * A database of one row.  DynamoDB doesn't care.  DynamoDB is cool.
     */
    id: "theonlyitem";

    /**
     * The name of the last binlog file that was processed successfully.  This increases
     * monotonically.  bin.000001, bin.000002, etc...
     */
    binlogName: string | null;

    /**
     * The byte of the last binlog entry in the file that was processed successfully.  This
     * increases monotonically until it is reset for the next file with a Rotate event.
     */
    binlogPosition: number | null;

    /**
     * Track version of the state to prevent bad overwriting.  This is managed automatically
     * by Dynameh.
     */
    version?: number;
}
