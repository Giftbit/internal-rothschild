import * as chai from "chai";
import {getKnexRead} from "./dbUtils";

describe("dbUtils", () => {
    describe("getKnexRead()", () => {
        it("throws an Error when attempting to modify the database", async () => {
            const knex = await getKnexRead();

            chai.assert.throws(() => {
                knex.insert({a: "a"}).into("ValueStores");
            }, "Attempting to modify database from read-only connection.");

            chai.assert.throws(() => {
                knex("ValueStores").insert({a: "a"});
            }, "Attempting to modify database from read-only connection.");
        });
    });
});
