import {getKnexRead} from "./connection";

// noinspection JSUnusedGlobalSymbols Referenced in a package.json script.
/**
 * Get the current rothschild database schema in CREATE TABLE statements.
 */
export async function getDbSchema(): Promise<string> {
    const knex = await getKnexRead();
    const showTablesRes: [{Tables_in_rothschild: string}[], any[]] = await knex.raw("SHOW TABLES");
    const showCreateTablesRes: [[{Table: string, "Create Table": string}], [any, any]][] = await Promise.all(showTablesRes[0].map(table => knex.raw("SHOW CREATE TABLE ??", table.Tables_in_rothschild)));
    const createTableStrings = showCreateTablesRes.map(res => res[0][0]["Create Table"]);
    return createTableStrings.join("\n\n");
}
