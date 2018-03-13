import * as dynameh from "dynameh";

export interface Fullcode {
    moneyBucketId: string;
    lastFour: string;
    encryptedFullcode: string;
}

export function getFullcodeTableSchema(userId: string): dynameh.TableSchema {
    return {
        tableName: `fullcode-${userId}`,
        primaryKeyField: "moneyBucketId",
        primaryKeyType: "string",
        versionKeyField: "version"
    };
}

export function getEncryptedFullcodeTableSchema(userId: string): dynameh.TableSchema {
    return {
        ...getFullcodeTableSchema(userId),
        // primaryKeyField: "encryptedFullcode",    // TODO remember if I need to do this
        indexName: `encryptedFullcode-${userId}`
    };
}
