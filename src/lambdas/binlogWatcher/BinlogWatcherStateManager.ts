import * as aws from "aws-sdk";
import * as dynameh from "dynameh";
import {BinlogEvent} from "./binlogStream/BinlogEvent";
import {BinlogTransaction} from "./binlogTransaction/BinlogTransaction";
import {BinlogWatcherState} from "./BinlogWatcherState";
import log = require("loglevel");

export class BinlogWatcherStateManager {

    private checkpointPauseCount: number = 0;
    private state: BinlogWatcherState | null = null;
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

    pauseCheckpointing(): void {
        this.checkpointPauseCount++;
    }

    unpauseCheckpointing(): void {
        this.checkpointPauseCount--;
        if (this.checkpointPauseCount < 0) {
            log.error("BinlogCheckpointer.checkpointPauseCount < 0");
            this.checkpointPauseCount = 0;
        }
    }

    onBinlogEvent(event: BinlogEvent): void {
        if (!this.checkpointPauseCount) {
            return;
        }
        this.state.binlogName = event.binlogName;
        this.state.binlogPosition = event.binlog.nextPosition;
    }

    onTransaction(tx: BinlogTransaction): void {
        if (!this.checkpointPauseCount) {
            return;
        }
        this.state.binlogName = tx.binlogName;
        this.state.binlogPosition = tx.nextPosition;
    }

    async save(): Promise<void> {
        // TODO checkpointPauseCount isn't right.  The checkpoint should be based upon the last successfully sent LightrailMessage.
        if (!this.checkpointPauseCount) {
            throw new Error("BinlogWatcherStateManager checkpointing is paused and refusing to save state.");
        }

        const putRequest = dynameh.requestBuilder.buildPutInput(this.tableSchema, this.state);
        log.debug("BinlogWatcherStateManager putRequest=", JSON.stringify(putRequest));

        const putResponse = await this.dynamodb.putItem(putRequest).promise();
        log.debug("BinlogWatcherStateManager putResponse=", JSON.stringify(putResponse));
    }

    async load(): Promise<BinlogWatcherState> {
        if (!this.checkpointPauseCount) {
            throw new Error("BinlogWatcherStateManager checkpointing is paused and refusing to load state.");
        }

        const getRequest = dynameh.requestBuilder.buildGetInput(this.tableSchema, "theonlyitem");
        log.debug("BinlogWatcherStateManager getRequest=", getRequest);

        const getResponse = await this.dynamodb.getItem(getRequest).promise();
        log.debug("BinlogWatcherStateManager getResponse=", JSON.stringify(getResponse));

        this.state = dynameh.responseUnwrapper.unwrapGetOutput(getResponse);
        if (this.state === null) {
            log.warn("BinlogWatcherStateManager did not find existing state.  This should only happen the very first time this Lambda runs!");
            this.state = {
                id: "theonlyitem",
                binlogName: null,
                binlogPosition: null
            };
        }
        return this.state;
    }
}
