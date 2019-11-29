import {ZongJiEvent} from "./ZongJiEvent";

export interface BinlogEvent<T extends ZongJiEvent = ZongJiEvent> {
    binlog: T;
    binlogName: string;
}
