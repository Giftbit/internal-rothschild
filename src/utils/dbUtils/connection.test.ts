import * as chai from "chai";
import {getKnexRead} from "./connection";
import {resetDb} from "../testUtils";

describe("connection", () => {

    before(async () => {
        await resetDb();
    });

    it("the test MySQL instance has the same settings as the production MySQL instance", async () => {
        const assertMsg = "if this fails you may need to delete your existing MySQL container with 'docker rm -f rothschild-test-mysql' and then re-run the tests";

        const knex = await getKnexRead();
        const strictModeRes = await knex.raw("SHOW VARIABLES LIKE 'innodb_strict_mode'");
        chai.assert.equal(strictModeRes[0][0]["Variable_name"], "innodb_strict_mode");
        chai.assert.equal(strictModeRes[0][0]["Value"], "ON", assertMsg);

        const sqlModeRes = await knex.raw("SELECT @@sql_mode");
        chai.assert.sameMembers(sqlModeRes[0][0]["@@sql_mode"].split(","), ["IGNORE_SPACE", "STRICT_TRANS_TABLES"], assertMsg);
    });

    describe("getKnexRead()", () => {
        it("throws an Error when attempting to modify the database", async () => {
            const knex = await getKnexRead();

            chai.assert.throws(() => {
                knex.insert({a: "a"}).into("Values");
            }, "Attempting to modify database from read-only connection.");

            chai.assert.throws(() => {
                knex("Values").insert({a: "a"});
            }, "Attempting to modify database from read-only connection.");

            chai.assert.throws(() => {
                knex.queryBuilder().insert({a: "a"});
            }, "Attempting to modify database from read-only connection.");
        });
    });
});
