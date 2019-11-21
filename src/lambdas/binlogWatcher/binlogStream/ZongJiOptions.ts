export interface ZongJiOptions {
    serverId?: number;
    startAtEnd?: boolean;
    filename?: string;
    position?: number;
    includeSchema?: { [schema: string]: boolean | string[] };
    excludeSchema?: { [schema: string]: boolean | string[] };
}
