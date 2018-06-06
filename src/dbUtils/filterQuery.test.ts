import * as chai from "chai";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {getKnexRead, getKnexWrite} from "./connection";
import * as testUtils from "../testUtils";
import {filterQuery, FilterQueryOptions} from "./filterQuery";

describe("filterQuery()", () => {

    interface FilterTest {
        userId: string;
        id: string;
        a: string;
        b: number;
        c: boolean;
        d: Date;
    }

    const filterTestFilterOptions: FilterQueryOptions = {
        properties: {
            a: {
                type: "string"
            },
            b: {
                type: "number"
            },
            c: {
                type: "boolean"
            },
            d: {
                type: "Date"
            }
        }
    };

    before(async () => {
        await testUtils.resetDb();

        const knex = await getKnexWrite();
        await knex.raw("CREATE TABLE rothschild.FilterTest (\n" +
            "  userId VARCHAR(32)  NOT NULL,\n" +
            "  id     VARCHAR(32)  NOT NULL," +
            "  a      VARCHAR(255) NOT NULL,\n" +
            "  b      INT          NOT NULL,\n" +
            "  c      BOOLEAN      NOT NULL,\n" +
            "  d      DATETIME     NOT NULL,\n" +
            "  PRIMARY KEY pk_Row (userId, id)\n" +
            ");");

        const rows: FilterTest[] = [];

        for (let i = 0; i < 1010; i++) {
            rows.push({
                userId: i < 1000 ? "user1" : "user2",
                id: `id-${i}`,
                a: Math.abs(Math.sin(i)).toString(36).substring(2),
                b: Math.floor(Math.abs(Math.tan(i))) * 10,
                c: !!(i % 3),
                d: new Date(400464000000 + i * 1000)
            });
        }

        await knex.into("FilterTest").insert(rows);
    });

    it("filters eq by default", async () => {
        const knex = await getKnexRead();

        const expected = await knex("FilterTest")
            .where({
                userId: "user1",
                b: 100,
                c: true
            })
            .orderBy("id");
        chai.assert.isAtLeast(expected.length, 1, "at least 1 row expected");

        const actual: FilterTest[] = await filterQuery(
            knex("FilterTest")
                .where({userId: "user1"})
                .orderBy("id"),
            {
                b: "100",
                c: "true"
            },
            filterTestFilterOptions
        );

        chai.assert.deepEqual(actual, expected);
    });

    it("filters ne", async () => {
        const knex = await getKnexRead();

        const expected = await knex("FilterTest")
            .where({
                userId: "user1"
            })
            .where("c", "!=", false)
            .orderBy("id");
        chai.assert.isAtLeast(expected.length, 1, "at least 1 row expected");

        const actual: FilterTest[] = await filterQuery(
            knex("FilterTest")
                .where({userId: "user1"})
                .orderBy("id"),
            {
                "c.ne": "false"
            },
            filterTestFilterOptions
        );

        chai.assert.deepEqual(actual, expected);
    });

    it("filters lt", async () => {
        const knex = await getKnexRead();

        const expected = await knex("FilterTest")
            .where({
                userId: "user1"
            })
            .where("b", "<", 25)
            .orderBy("id");
        chai.assert.isAtLeast(expected.length, 1, "at least 1 row expected");

        const actual: FilterTest[] = await filterQuery(
            knex("FilterTest")
                .where({userId: "user1"})
                .orderBy("id"),
            {
                "b.lt": "25"
            },
            filterTestFilterOptions
        );

        chai.assert.deepEqual(actual, expected);
    });

    it("filters lte", async () => {
        const knex = await getKnexRead();

        const expected = await knex("FilterTest")
            .where({
                userId: "user1"
            })
            .where("d", "<=", new Date("1982-09-10T00:00:50.000Z"))
            .orderBy("id");
        chai.assert.isAtLeast(expected.length, 1, "at least 1 row expected");

        const actual: FilterTest[] = await filterQuery(
            knex("FilterTest")
                .where({userId: "user1"})
                .orderBy("id"),
            {
                "d.lte": "1982-09-10T00:00:50.000Z"
            },
            filterTestFilterOptions
        );

        chai.assert.deepEqual(actual, expected);
    });

    it("filters gt", async () => {
        const knex = await getKnexRead();

        const expected = await knex("FilterTest")
            .where({
                userId: "user1"
            })
            .where("b", ">", 650)
            .orderBy("id");
        chai.assert.isAtLeast(expected.length, 1, "at least 1 row expected");

        const actual: FilterTest[] = await filterQuery(
            knex("FilterTest")
                .where({userId: "user1"})
                .orderBy("id"),
            {
                "b.gt": "650"
            },
            filterTestFilterOptions
        );

        chai.assert.deepEqual(actual, expected);
    });

    it("filters gte", async () => {
        const knex = await getKnexRead();

        const expected = await knex("FilterTest")
            .where({
                userId: "user1"
            })
            .where("b", ">=", 650)
            .orderBy("id");
        chai.assert.isAtLeast(expected.length, 1, "at least 1 row expected");

        const actual: FilterTest[] = await filterQuery(
            knex("FilterTest")
                .where({userId: "user1"})
                .orderBy("id"),
            {
                "b.gte": "650"
            },
            filterTestFilterOptions
        );

        chai.assert.deepEqual(actual, expected);
    });

    it("filters like", async () => {
        const knex = await getKnexRead();

        const expected = await knex("FilterTest")
            .where({
                userId: "user1"
            })
            .where("a", "LIKE", "%aa%")
            .orderBy("id");
        chai.assert.isAtLeast(expected.length, 1, "at least 1 row expected");

        const actual: FilterTest[] = await filterQuery(
            knex("FilterTest")
                .where({userId: "user1"})
                .orderBy("id"),
            {
                "a.like": "%aa%"
            },
            filterTestFilterOptions
        );

        chai.assert.deepEqual(actual, expected);
    });

    it("can combine filters", async () => {
        const knex = await getKnexRead();

        const expected = await knex("FilterTest")
            .where({
                userId: "user1"
            })
            .where("a", "LIKE", "%a%")
            .where("b", ">", 100)
            .where("b", "<", 300)
            .orderBy("id");
        chai.assert.isAtLeast(expected.length, 1, "at least 1 row expected");

        const actual: FilterTest[] = await filterQuery(
            knex("FilterTest")
                .where({userId: "user1"})
                .orderBy("id"),
            {
                "a.like": "%a%",
                "b.gt": "100",
                "b.lt": "300"
            },
            filterTestFilterOptions
        );

        chai.assert.deepEqual(actual, expected);
    });

    it("ignores query parameters that aren't specified in options", async () => {
        const knex = await getKnexRead();

        const expected = await knex("FilterTest")
            .where({
                userId: "user1",
                c: true
            })
            .where("a", "<", "fff")
            .orderBy("id");
        chai.assert.isAtLeast(expected.length, 1, "at least 1 row expected");

        const actual: FilterTest[] = await filterQuery(
            knex("FilterTest")
                .where({userId: "user1"})
                .orderBy("id"),
            {
                "a.lt": "fff",
                "c": "true",
                "e": "asdf",
                "f.lt": "99",
                "limit": "100",
                "after": "0xdeafbeef",
                "_cacheBust": "this is common"
            },
            filterTestFilterOptions
        );

        chai.assert.deepEqual(actual, expected);
    });

    it("throws a 400 exception if a number value cannot be parsed", async () => {
        const knex = await getKnexRead();
        let ex: giftbitRoutes.GiftbitRestError;

        try {
            filterQuery(
                knex("FilterTest")
                    .where({userId: "user1"})
                    .orderBy("id"),
                {
                    b: "NaNaNaN Batman"
                },
                filterTestFilterOptions
            );
        } catch (e) {
            ex = e;
        }
        chai.assert.isDefined(ex, "exception thrown");
        chai.assert.isTrue(ex.isRestError);
        chai.assert.equal(ex.statusCode, 400);
    });

    it("throws a 400 exception if a Date value cannot be parsed", async () => {
        const knex = await getKnexRead();
        let ex: giftbitRoutes.GiftbitRestError;

        try {
            filterQuery(
                knex("FilterTest")
                    .where({userId: "user1"})
                    .orderBy("id"),
                {
                    d: "Canada Day"
                },
                filterTestFilterOptions
            );
        } catch (e) {
            ex = e;
        }
        chai.assert.isDefined(ex, "exception thrown");
        chai.assert.isTrue(ex.isRestError);
        chai.assert.equal(ex.statusCode, 400);
    });
});
