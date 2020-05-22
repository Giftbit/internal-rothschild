import * as aws from "aws-sdk";
import * as dynameh from "dynameh";
import {BinlogWatcherState} from "./BinlogWatcherState";
import log = require("loglevel");

/**
 * Manages the BinlogWatcherState with loading, saving and updating the checkpoint.
 */
export class BinlogWatcherStateManager {

    state: BinlogWatcherState | null = null;
    private stateAsLoaded: BinlogWatcherState | null = null;

    private dynamodb = new aws.DynamoDB({
        apiVersion: "2012-08-10",
        credentials: new aws.EnvironmentCredentials("AWS"),
        region: process.env["AWS_REGION"],
        httpOptions: {
            // Both being 10s sets a maximum DDB timeout to be 20s.
            timeout: 10000,
            connectTimeout: 10000
        }
    });
    private tableSchema: dynameh.TableSchema = {
        tableName: process.env["DDB_TABLE"] || "Storage",
        partitionKeyField: "id",
        partitionKeyType: "string",
        versionKeyField: "version"
    };

    private openCheckpoints: BinlogWatcherState.Checkpoint[] = [];
    private closedCheckpoints: BinlogWatcherState.Checkpoint[] = [];

    /**
     * Opens a checkpoint at the start of an operation.  Until this checkpoint completes
     * the state checkpoint cannot advance past this point.
     */
    openCheckpoint(binlogName: string, binlogPosition: number): void {
        const openCheckpoint = {
            binlogName,
            binlogPosition
        };
        if (this.state.checkpoint != null && BinlogWatcherState.Checkpoint.compare(openCheckpoint, this.state.checkpoint) < 0) {
            throw new Error(`Cannot open checkpoint before current state. openCheckpoint=${JSON.stringify(openCheckpoint)}, this.state=${JSON.stringify(this.state)}`);
        }
        this.openCheckpoints.push(openCheckpoint);
    }

    /**
     * Closes the previously opened checkpoint at the end of an operation.  After
     * this the checkpoint may advance as far as the last closed checkpoint that
     * is not before an open checkpoint.
     *
     * An example:
     * event      | latest checkpoint
     * -----------|-------------------
     * A open     | null
     * A complete | A
     * B open     | A
     * C open     | A
     * C complete | A (because B is blocking)
     * B complete | C
     */
    closeCheckpoint(binlogName: string, binlogPosition: number): void {
        const openCheckpointIx = this.openCheckpoints.findIndex(c => c.binlogName === binlogName && c.binlogPosition === binlogPosition);
        if (openCheckpointIx === -1) {
            throw new Error("checkpointComplete does not have a matching start");
        }
        this.closedCheckpoints.push(this.openCheckpoints.splice(openCheckpointIx, 1)[0]);

        for (let checkpointIx = 0; checkpointIx < this.closedCheckpoints.length; checkpointIx++) {
            const closedCheckpoint = this.closedCheckpoints[checkpointIx];
            const earlierOpenCheckpoint = this.openCheckpoints.find(c => BinlogWatcherState.Checkpoint.compare(c, closedCheckpoint) <= 0);
            if (!earlierOpenCheckpoint) {
                this.closedCheckpoints.splice(checkpointIx, 1);
                if (this.state.checkpoint == null || BinlogWatcherState.Checkpoint.compare(closedCheckpoint, this.state.checkpoint) > 0) {
                    this.state.checkpoint = closedCheckpoint;
                }
            }
        }
    }

    /**
     * Returns true if the binlog is old enough to justify flushing.
     */
    shouldFlushBinlog(): boolean {
        const twoDaysAgo = new Date();
        twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
        return !this.state.flushBinlogDate || this.state.flushBinlogDate < twoDaysAgo.toISOString();
    }

    /**
     * Note in the state that the binlog has been flushed.
     */
    binlogFlushed(): void {
        this.state.flushBinlogDate = new Date().toISOString();
    }

    async save(): Promise<void> {
        if (this.state?.checkpoint?.binlogPosition === this.stateAsLoaded?.checkpoint?.binlogPosition
            && this.state?.checkpoint?.binlogName === this.stateAsLoaded?.checkpoint?.binlogName
            && this.state?.flushBinlogDate === this.stateAsLoaded?.flushBinlogDate
        ) {
            log.info("BinlogWatcherStateManager not saving because state hasn't changed.");
            return;
        }

        log.info("BinlogWatcherStateManager saving state", this.state);

        const putRequest = dynameh.requestBuilder.buildPutInput(this.tableSchema, this.state);
        log.debug("BinlogWatcherStateManager putRequest=", JSON.stringify(putRequest));

        const putResponse = await this.dynamodb.putItem(putRequest).promise();
        log.debug("BinlogWatcherStateManager putResponse=", JSON.stringify(putResponse));
    }

    async load(): Promise<void> {
        const getRequest = dynameh.requestBuilder.buildGetInput(this.tableSchema, "BinlogWatcherState");
        log.debug("BinlogWatcherStateManager getRequest=", getRequest);

        const getResponse = await this.dynamodb.getItem(getRequest).promise();
        log.debug("BinlogWatcherStateManager getResponse=", JSON.stringify(getResponse));

        this.state = dynameh.responseUnwrapper.unwrapGetOutput(getResponse);
        this.stateAsLoaded = dynameh.responseUnwrapper.unwrapGetOutput(getResponse);
        if (this.state === null) {
            log.warn("BinlogWatcherStateManager did not find existing state.  This should only happen the very first time this Lambda runs!");
            this.state = {
                id: "BinlogWatcherState",
                checkpoint: null
            };
        } else {
            log.info("BinlogWatcherStateManager loaded state", this.state);
        }
    }
}
