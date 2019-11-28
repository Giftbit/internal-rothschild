import {ZongJiEvent} from "./ZongJiEvent";

export interface BinlogEvent<T extends ZongJiEvent> {
    binlog: T;
    binlogName: string;
}
