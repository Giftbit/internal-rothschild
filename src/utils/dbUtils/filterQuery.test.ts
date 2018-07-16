import * as chai from "chai";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {getKnexRead, getKnexWrite} from "./connection";
import * as testUtils from "../testUtils";
import {filterQuery, FilterQueryOptions} from "./filterQuery";
import * as cryptojs from "crypto-js";

describe("filterQuery()", () => {

    interface FilterTest {
        userId: string;
        id: string;
        index: number;
        a: string;
        b: number;
        c: boolean;
        d: Date;
        code: string;
    }

    interface FilterTestDb {
        userId: string;
        id: string;
        indexPlus25: number;
        a: string;
        b: number;
        c: boolean;
        d: Date;
        codeHashed: string;
    }

    function filterTestToFilterTestDb(v: FilterTest): FilterTestDb {
        return {
            userId: v.userId,
            id: v.id,
            indexPlus25: v.index + 25,
            a: v.a,
            b: v.b,
            c: v.c,
            d: v.d,
            codeHashed: hashCode(v.code)
        };
    }

    const filterTestFilterOptions: FilterQueryOptions = {
        properties: {
            id: {
                type: "string",
                operators: ["eq", "in"]
            },
            index: {
                type: "number",
                columnName: "indexPlus25",
                valueMap: value => value + 25,
                operators: ["lt", "lte", "gt", "gte", "eq", "ne", "in"]
            },
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
            },
            code: {
                type: "string",
                columnName: "codeHashed",
                valueMap: value => hashCode(value),
                operators: ["eq", "in"]
            }
        }
    };

    function hashCode(value: string) {
        return cryptojs.SHA512(value).toString();
    }

    before(async () => {
        await testUtils.resetDb();

        const knex = await getKnexWrite();
        await knex.raw("CREATE TABLE rothschild.FilterTest (\n" +
            "  userId      VARCHAR(32)  NOT NULL,\n" +
            "  id          VARCHAR(32)  NOT NULL," +
            "  indexPlus25 INT          NOT NULL," +
            "  a           VARCHAR(255) NOT NULL,\n" +
            "  b           INT          NOT NULL,\n" +
            "  c           BOOLEAN      NOT NULL,\n" +
            "  d           DATETIME     NOT NULL,\n" +
            "  codeHashed TEXT,\n" +
            "  PRIMARY KEY pk_Row (userId, id)\n" +
            ");");

        const rows: FilterTest[] = [];

        for (let i = 0; i < 1010; i++) {
            rows.push({
                userId: i < 1000 ? "user1" : "user2",
                id: `id-${i}`,
                index: i,
                a: Math.abs(Math.sin(i)).toString(36).substring(2),
                b: Math.floor(Math.abs(Math.tan(i))) * 10,
                c: !!(i % 3),
                d: new Date(400464000000 + i * 1000),
                code: `CODE-${i.toString()}`
            });
        }

        const rowsForInsert: FilterTestDb[] = rows.map(v => filterTestToFilterTestDb(v));
        await knex.into("FilterTest").insert(rowsForInsert);
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

        const actual: FilterTestDb[] = await filterQuery(
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

        const actual: FilterTestDb[] = await filterQuery(
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

        const actual: FilterTestDb[] = await filterQuery(
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

        const actual: FilterTestDb[] = await filterQuery(
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

        const actual: FilterTestDb[] = await filterQuery(
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

        const actual: FilterTestDb[] = await filterQuery(
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

    it("filters in", async () => {
        const knex = await getKnexRead();

        const expected = await knex("FilterTest")
            .where({
                userId: "user1"
            })
            .whereIn("id", ["id-1", "id-2", "id-3", "id-5", "id-8", "id-13", "id-21", "id-34", "id-55", "id-89", "id-144", "id-233", "id-377", "id-610", "id-987"])
            .orderBy("id");

        const actual: FilterTestDb[] = await filterQuery(
            knex("FilterTest")
                .where({userId: "user1"})
                .orderBy("id"),
            {
                "id.in": "id-1,id-2,id-3,id-5,id-8,id-13,id-21,id-34,id-55,id-89,id-144,id-233,id-377,id-610,id-987"
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

        const actual: FilterTestDb[] = await filterQuery(
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

        const actual: FilterTestDb[] = await filterQuery(
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

    it("querying by code which becomes hashed when persisted to the database", async () => {
        const knex = await getKnexRead();

        const expected: FilterTestDb[] = await knex("FilterTest")
            .where({
                userId: "user1"
            })
            .where("codeHashed", hashCode("CODE-623"));
        chai.assert.lengthOf(expected, 1, "expected exactly 1 row");
        chai.assert.equal(expected[0].id, "id-623", "expected id=id-623");

        const actual: FilterTestDb[] = await filterQuery(
            knex("FilterTest")
                .where({userId: "user1"})
                .orderBy("id"),
            {
                "code": "CODE-623"
            },
            filterTestFilterOptions
        );
        chai.assert.deepEqual(actual, expected);
    });

    it("querying by hashed value with 'in' operator and single value", async () => {
        const knex = await getKnexRead();

        const expected: FilterTestDb[] = await knex("FilterTest")
            .where({
                userId: "user1"
            })
            .whereIn("codeHashed", [hashCode("CODE-623")])
            .orderBy("id");
        chai.assert.lengthOf(expected, 1, "expected exactly 1 row");
        chai.assert.equal(expected[0].id, "id-623", "expected id=id-623");

        const actual: FilterTestDb[] = await filterQuery(
            knex("FilterTest")
                .where({userId: "user1"})
                .orderBy("id"),
            {
                "code.in": "CODE-623"
            },
            filterTestFilterOptions
        );
        chai.assert.deepEqual(actual, expected);
    });

    describe("filtering by index which becomes index + 25 when persisted to the database", () => {
        it("eq", async () => {
            const knex = await getKnexRead();

            const expected: FilterTestDb[] = await knex("FilterTest")
                .where({
                    userId: "user1"
                })
                .where("indexPlus25", 75)
                .orderBy("id");
            chai.assert.lengthOf(expected, 1);
            chai.assert.equal(expected[0].id, "id-50");

            const actual: FilterTestDb[] = await filterQuery(
                knex("FilterTest")
                    .where({userId: "user1"})
                    .orderBy("id"),
                {
                    "index.eq": "50"
                },
                filterTestFilterOptions
            );
            chai.assert.deepEqual(actual, expected);
        });

        it("in", async () => {
            const knex = await getKnexRead();

            const expected: FilterTestDb[] = await knex("FilterTest")
                .where({
                    userId: "user1"
                })
                .whereIn("indexPlus25", [75, 76])
                .orderBy("id");
            chai.assert.lengthOf(expected, 2);
            chai.assert.equal(expected[0].id, "id-50");
            chai.assert.equal(expected[1].id, "id-51");

            const actual: FilterTestDb[] = await filterQuery(
                knex("FilterTest")
                    .where({userId: "user1"})
                    .orderBy("id"),
                {
                    "index.in": "50,51"
                },
                filterTestFilterOptions
            );
            chai.assert.deepEqual(actual, expected);
        });

        it("gt", async () => {
            const knex = await getKnexRead();

            const expected: FilterTestDb[] = await knex("FilterTest")
                .where({
                    userId: "user1"
                })
                .where("indexPlus25", ">", 1020)
                .orderBy("id");
            chai.assert.lengthOf(expected, 4);

            const actual: FilterTestDb[] = await filterQuery(
                knex("FilterTest")
                    .where({userId: "user1"})
                    .orderBy("id"),
                {
                    "index.gt": "995"
                },
                filterTestFilterOptions
            );
            chai.assert.deepEqual(actual, expected);
        });


        it("gte", async () => {
            const knex = await getKnexRead();

            const expected: FilterTestDb[] = await knex("FilterTest")
                .where({
                    userId: "user1"
                })
                .where("indexPlus25", ">=", 1020)
                .orderBy("id");
            chai.assert.lengthOf(expected, 5);

            const actual: FilterTestDb[] = await filterQuery(
                knex("FilterTest")
                    .where({userId: "user1"})
                    .orderBy("id"),
                {
                    "index.gte": "995"
                },
                filterTestFilterOptions
            );
            chai.assert.deepEqual(actual, expected);
        });

        it("lt", async () => {
            const knex = await getKnexRead();

            const expected: FilterTestDb[] = await knex("FilterTest")
                .where({
                    userId: "user1"
                })
                .where("indexPlus25", "<", 29)
                .orderBy("id");
            chai.assert.lengthOf(expected, 4);

            const actual: FilterTestDb[] = await filterQuery(
                knex("FilterTest")
                    .where({userId: "user1"})
                    .orderBy("id"),
                {
                    "index.lt": "4"
                },
                filterTestFilterOptions
            );
            chai.assert.deepEqual(actual, expected);
        });

        it("lte", async () => {
            const knex = await getKnexRead();

            const expected: FilterTestDb[] = await knex("FilterTest")
                .where({
                    userId: "user1"
                })
                .where("indexPlus25", "<=", 29)
                .orderBy("id");
            chai.assert.lengthOf(expected, 5);

            const actual: FilterTestDb[] = await filterQuery(
                knex("FilterTest")
                    .where({userId: "user1"})
                    .orderBy("id"),
                {
                    "index.lte": "4"
                },
                filterTestFilterOptions
            );
            chai.assert.deepEqual(actual, expected);
        });

        it("ne", async () => {
            const knex = await getKnexRead();

            const expected: FilterTestDb[] = await knex("FilterTest")
                .where({
                    userId: "user1"
                })
                .where("indexPlus25", "!=", 50)
                .orderBy("id");
            chai.assert.lengthOf(expected, 999);

            const actual: FilterTestDb[] = await filterQuery(
                knex("FilterTest")
                    .where({userId: "user1"})
                    .orderBy("id"),
                {
                    "index.ne": "25"
                },
                filterTestFilterOptions
            );
            chai.assert.deepEqual(actual, expected);
        });
    });
    //"lt", "lte", "ne"

    it("querying by hashed value with 'in' operator and multiple values", async () => {
        const knex = await getKnexRead();

        const expected: FilterTestDb[] = await knex("FilterTest")
            .whereIn("codeHashed", [hashCode("CODE-623"), hashCode("CODE-821")])
            .orderBy("id");
        chai.assert.lengthOf(expected, 2, "expected exactly 2 rows");
        chai.assert.equal(expected[0].id, "id-623", "expected id=id-623");
        chai.assert.equal(expected[1].id, "id-821", "expected id=id-821");

        const actual: FilterTestDb[] = await filterQuery(
            knex("FilterTest")
                .where({userId: "user1"})
                .orderBy("id"),
            {
                "code.in": "CODE-623,CODE-821"
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

        const actual: FilterTestDb[] = await filterQuery(
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

    it("throws a 400 exception if the property is known but the operator can't be used", async () => {
        const knex = await getKnexRead();
        let ex: giftbitRoutes.GiftbitRestError;

        try {
            filterQuery(
                knex("FilterTest")
                    .where({userId: "user1"})
                    .orderBy("id"),
                {
                    "id.like": "?1234"
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

    it("throws a 400 exception if the property is known but the operator is unknown", async () => {
        const knex = await getKnexRead();
        let ex: giftbitRoutes.GiftbitRestError;

        try {
            filterQuery(
                knex("FilterTest")
                    .where({userId: "user1"})
                    .orderBy("id"),
                {
                    "b.kwyjibo": "what's up?"
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
