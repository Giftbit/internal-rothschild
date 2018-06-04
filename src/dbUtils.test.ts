import * as chai from "chai";
import * as testUtils from "./testUtils";
import {getKnexRead, getKnexWrite, paginateQuery} from "./dbUtils";

describe("dbUtils", () => {
    describe("getKnexRead()", () => {
        it("throws an Error when attempting to modify the database", async () => {
            const knex = await getKnexRead();

            chai.assert.throws(() => {
                knex.insert({a: "a"}).into("Values");
            }, "Attempting to modify database from read-only connection.");

            chai.assert.throws(() => {
                knex("Values").insert({a: "a"});
            }, "Attempting to modify database from read-only connection.");
        });
    });

    describe("paginateQuery()", () => {
        interface PaginationTest {
            userId: string;
            id: string;
            a: string;
            b: number;
            c: boolean;
        }

        before(async () => {
            await testUtils.resetDb();

            const knex = await getKnexWrite();
            await knex.raw("CREATE TABLE rothschild.PaginationTest (\n" +
                "  userId VARCHAR(32)  NOT NULL,\n" +
                "  id     VARCHAR(32)  NOT NULL," +
                "  a      VARCHAR(255) NOT NULL,\n" +
                "  b      INT          NOT NULL,\n" +
                "  c      BOOLEAN      NOT NULL,\n" +
                "  PRIMARY KEY pk_Row (userId, id)\n" +
                ");");

            const rows: PaginationTest[] = [];

            for (let i = 0; i < 1010; i++) {
                rows.push({
                    userId: i < 1000 ? "user1" : "user2",
                    id: `id-${i}`,
                    a: Math.abs(Math.sin(i)).toString(36).substring(2),
                    b: Math.floor(Math.abs(Math.tan(i))) * 10,
                    c: !!(i % 3)
                });
            }

            await knex.into("PaginationTest").insert(rows);
        });

        it("pages back and forth with before & after", async () => {
            const knex = await getKnexRead();

            const firstThirty: PaginationTest[] = await knex("PaginationTest")
                .where({
                    userId: "user1"
                })
                .limit(30);

            const page1 = await paginateQuery<PaginationTest>(
                knex("PaginationTest")
                    .where({
                        userId: "user1"
                    }),
                {
                    limit: 10,
                    maxLimit: 10,
                    sort: null,
                    before: null,
                    after: null,
                    last: false
                }
            );
            chai.assert.deepEqual(page1.body, firstThirty.slice(0, 10), "page1");

            const page2 = await paginateQuery(
                knex("PaginationTest")
                    .where({
                        userId: "user1"
                    }),
                {
                    limit: 10,
                    maxLimit: 10,
                    sort: null,
                    before: null,
                    after: page1.pagination.after,
                    last: false
                }
            );
            chai.assert.deepEqual(page2.body, firstThirty.slice(10, 20), "page2");

            const page3 = await paginateQuery<PaginationTest>(
                knex("PaginationTest")
                    .where({
                        userId: "user1"
                    }),
                {
                    limit: 10,
                    maxLimit: 10,
                    before: null,
                    after: page2.pagination.after,
                    sort: null,
                    last: false
                }
            );
            chai.assert.deepEqual(page3.body, firstThirty.slice(20, 30), "page3");

            const page3prev = await paginateQuery<PaginationTest>(
                knex("PaginationTest")
                    .where({
                        userId: "user1"
                    }),
                {
                    limit: 10,
                    maxLimit: 10,
                    sort: null,
                    before: page3.pagination.before,
                    after: null,
                    last: false
                }
            );
            chai.assert.deepEqual(page3prev.body, page2.body, "page3prev");

            const page3prevprev = await paginateQuery<PaginationTest>(
                knex("PaginationTest")
                    .where({
                        userId: "user1"
                    }),
                {
                    limit: 10,
                    maxLimit: 10,
                    sort: null,
                    before: page3prev.pagination.before,
                    after: null,
                    last: false
                }
            );
            chai.assert.deepEqual(page3prevprev.body, page1.body, "page3prevprev");
        });

        it("can page to last", async () => {
            const knex = await getKnexRead();

            const lastPage = await paginateQuery<PaginationTest>(
                knex("PaginationTest")
                    .where({
                        userId: "user1"
                    }),
                {
                    limit: 5,
                    maxLimit: 10,
                    sort: null,
                    before: null,
                    after: null,
                    last: true
                }
            );
            chai.assert.deepEqualExcludingEvery(
                lastPage.body,
                [
                    {
                        userId: "user1",
                        id: "id-995"
                    },
                    {
                        userId: "user1",
                        id: "id-996"
                    },
                    {
                        userId: "user1",
                        id: "id-997"
                    },
                    {
                        userId: "user1",
                        id: "id-998"
                    },
                    {
                        userId: "user1",
                        id: "id-999"
                    } as any
                ],
                ["a", "b", "c"],
                "lastPage");

            const secondLastPage = await paginateQuery<PaginationTest>(
                knex("PaginationTest")
                    .where({
                        userId: "user1"
                    }),
                {
                    limit: 5,
                    maxLimit: 10,
                    sort: null,
                    before: lastPage.pagination.before,
                    after: null,
                    last: false
                }
            );
            chai.assert.deepEqualExcludingEvery(
                secondLastPage.body,
                [
                    {
                        userId: "user1",
                        id: "id-990"
                    },
                    {
                        userId: "user1",
                        id: "id-991"
                    },
                    {
                        userId: "user1",
                        id: "id-992"
                    },
                    {
                        userId: "user1",
                        id: "id-993"
                    },
                    {
                        userId: "user1",
                        id: "id-994"
                    } as any
                ],
                ["a", "b", "c"],
                "secondLastPage");
        });

        it("pages a query with advanced filters", async () => {
            const knex = await getKnexRead();

            const page1 = await paginateQuery<PaginationTest>(
                knex("PaginationTest")
                    .where({
                        userId: "user1",
                        c: true
                    })
                    .where("b", ">", 50),
                {
                    limit: 10,
                    maxLimit: 10,
                    sort: null,
                    before: null,
                    after: null,
                    last: false
                }
            );
            chai.assert.lengthOf(page1.body, 10);
            for (let i = 0; i < page1.body.length; i++) {
                chai.assert.equal(page1.body[i].userId, "user1", `page1 row ${i}`);
                chai.assert.isTrue(page1.body[i].c, `page1 row ${i}`);
                chai.assert.isAtLeast(page1.body[i].b, 50, `page1 row ${i}`);
            }

            const page2 = await paginateQuery<PaginationTest>(
                knex("PaginationTest")
                    .where({
                        userId: "user1",
                        c: true
                    })
                    .where("b", ">", 50),
                {
                    limit: 10,
                    maxLimit: 10,
                    sort: null,
                    before: null,
                    after: page1.pagination.after,
                    last: false
                }
            );
            chai.assert.lengthOf(page2.body, 10);
            for (let i = 0; i < page2.body.length; i++) {
                chai.assert.equal(page2.body[i].userId, "user1", `page2 row ${i}`);
                chai.assert.isTrue(page2.body[i].c, `page2 row ${i}`);
                chai.assert.isAtLeast(page2.body[i].b, 50, `page2 row ${i}`);
            }

            const page2prev = await paginateQuery<PaginationTest>(
                knex("PaginationTest")
                    .where({
                        userId: "user1",
                        c: true
                    })
                    .where("b", ">", 50),
                {
                    limit: 10,
                    maxLimit: 10,
                    sort: null,
                    before: page2.pagination.before,
                    after: null,
                    last: false
                }
            );
            chai.assert.deepEqual(page2prev.body, page1.body, "page2prev");
        });

        it("pages a query with sorting", async () => {
            const knex = await getKnexRead();

            const firstThirty: PaginationTest[] = await knex("PaginationTest")
                .where({
                    userId: "user1"
                })
                .orderBy("b")
                .orderBy("id")
                .limit(30);

            const page1 = await paginateQuery<PaginationTest>(
                knex("PaginationTest")
                    .where({
                        userId: "user1"
                    }),
                {
                    limit: 10,
                    maxLimit: 10,
                    sort: {
                        field: "b",
                        asc: true
                    },
                    before: null,
                    after: null,
                    last: false
                }
            );
            chai.assert.deepEqual(page1.body, firstThirty.slice(0, 10), "page1");

            const page2 = await paginateQuery<PaginationTest>(
                knex("PaginationTest")
                    .where({
                        userId: "user1"
                    }),
                {
                    limit: 10,
                    maxLimit: 10,
                    sort: {
                        field: "b",
                        asc: true
                    },
                    before: null,
                    after: page1.pagination.after,
                    last: false
                }
            );
            chai.assert.deepEqual(page2.body, firstThirty.slice(10, 20), "page2");

            const page3 = await paginateQuery<PaginationTest>(
                knex("PaginationTest")
                    .where({
                        userId: "user1"
                    }),
                {
                    limit: 10,
                    maxLimit: 10,
                    sort: {
                        field: "b",
                        asc: true
                    },
                    before: null,
                    after: page2.pagination.after,
                    last: false
                }
            );
            chai.assert.deepEqual(page3.body, firstThirty.slice(20, 30), "page3");

            const page3prev = await paginateQuery<PaginationTest>(
                knex("PaginationTest")
                    .where({
                        userId: "user1"
                    }),
                {
                    limit: 10,
                    maxLimit: 10,
                    sort: {
                        field: "b",
                        asc: true
                    },
                    before: page3.pagination.before,
                    after: null,
                    last: false
                }
            );
            chai.assert.deepEqual(page3prev.body, page2.body, "page3prev");

            const page3prevprev = await paginateQuery<PaginationTest>(
                knex("PaginationTest")
                    .where({
                        userId: "user1"
                    }),
                {
                    limit: 10,
                    maxLimit: 10,
                    sort: {
                        field: "b",
                        asc: true
                    },
                    before: page3prev.pagination.before,
                    after: null,
                    last: false
                }
            );
            chai.assert.deepEqual(page3prevprev.body, page1.body, "page3prevprev");
        });

        it("pages a query in reverse order with sorting", async () => {
            const knex = await getKnexRead();

            const firstThirty: PaginationTest[] = await knex("PaginationTest")
                .where({
                    userId: "user1"
                })
                .orderBy("b", "DESC")
                .orderBy("id", "DESC")
                .limit(30);

            const page1 = await paginateQuery<PaginationTest>(
                knex("PaginationTest")
                    .where({
                        userId: "user1"
                    }),
                {
                    limit: 10,
                    maxLimit: 10,
                    sort: {
                        field: "b",
                        asc: false
                    },
                    before: null,
                    after: null,
                    last: false
                }
            );
            chai.assert.deepEqual(page1.body, firstThirty.slice(0, 10), "page1");

            const page2 = await paginateQuery<PaginationTest>(
                knex("PaginationTest")
                    .where({
                        userId: "user1"
                    }),
                {
                    limit: 10,
                    maxLimit: 10,
                    sort: {
                        field: "b",
                        asc: false
                    },
                    before: null,
                    after: page1.pagination.after,
                    last: false
                }
            );
            chai.assert.deepEqual(page2.body, firstThirty.slice(10, 20), "page2");

            const page3 = await paginateQuery<PaginationTest>(
                knex("PaginationTest")
                    .where({
                        userId: "user1"
                    }),
                {
                    limit: 10,
                    maxLimit: 10,
                    sort: {
                        field: "b",
                        asc: false
                    },
                    before: null,
                    after: page2.pagination.after,
                    last: false
                }
            );
            chai.assert.deepEqual(page3.body, firstThirty.slice(20, 30), "page3");

            const page3prev = await paginateQuery<PaginationTest>(
                knex("PaginationTest")
                    .where({
                        userId: "user1"
                    }),
                {
                    limit: 10,
                    maxLimit: 10,
                    sort: {
                        field: "b",
                        asc: false
                    },
                    before: page3.pagination.before,
                    after: null,
                    last: false
                }
            );
            chai.assert.deepEqual(page3prev.body, page2.body, "page3prev");

            const page3prevprev = await paginateQuery<PaginationTest>(
                knex("PaginationTest")
                    .where({
                        userId: "user1"
                    }),
                {
                    limit: 10,
                    maxLimit: 10,
                    sort: {
                        field: "b",
                        asc: false
                    },
                    before: page3prev.pagination.before,
                    after: null,
                    last: false
                }
            );
            chai.assert.deepEqual(page3prevprev.body, page1.body, "page3prevprev");
        });
    });
});
