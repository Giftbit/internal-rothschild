import * as dynameh from "dynameh";

export interface Fullcode {
    moneyBucketId: string;
    lastFour: string;
    encryptedFullcode: string;
}

export function getFullcodeTableSchema(userId: string): dynameh.TableSchema {
    return {
        tableName: `fFullcode-${userId}`,
        primaryKeyField: "moneyBucketId",
        primaryKeyType: "string",
        versionKeyField: "version"
    };
    // Also create a second index on encryptedFullcode
}
