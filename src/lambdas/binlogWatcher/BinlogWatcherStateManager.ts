import * as aws from "aws-sdk";
import * as dynameh from "dynameh";
import {BinlogWatcherState} from "./BinlogWatcherState";
import log = require("loglevel");

export class BinlogWatcherStateManager {

    state: BinlogWatcherState | null = null;

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
        this.openCheckpoints.push({
            binlogName,
            binlogPosition
        });
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
            const earlierOpenCheckpoint = this.openCheckpoints.find(c => BinlogWatcherState.Checkpoint.compare(c, closedCheckpoint) < 0);
            if (!earlierOpenCheckpoint) {
                this.closedCheckpoints.splice(checkpointIx, 1);
                if (BinlogWatcherState.Checkpoint.compare(closedCheckpoint, this.state.checkpoint) > 0) {
                    this.state.checkpoint = closedCheckpoint;
                }
            }
        }
    }

    async save(): Promise<void> {
        const putRequest = dynameh.requestBuilder.buildPutInput(this.tableSchema, this.state);
        log.debug("BinlogWatcherStateManager putRequest=", JSON.stringify(putRequest));

        const putResponse = await this.dynamodb.putItem(putRequest).promise();
        log.debug("BinlogWatcherStateManager putResponse=", JSON.stringify(putResponse));
    }

    async load(): Promise<void> {
        const getRequest = dynameh.requestBuilder.buildGetInput(this.tableSchema, "theonlyitem");
        log.debug("BinlogWatcherStateManager getRequest=", getRequest);

        const getResponse = await this.dynamodb.getItem(getRequest).promise();
        log.debug("BinlogWatcherStateManager getResponse=", JSON.stringify(getResponse));

        this.state = dynameh.responseUnwrapper.unwrapGetOutput(getResponse);
        if (this.state === null) {
            log.warn("BinlogWatcherStateManager did not find existing state.  This should only happen the very first time this Lambda runs!");
            this.state = {
                id: "BinlogWatcherState",
                checkpoint: null
            };
        }
    }
}
