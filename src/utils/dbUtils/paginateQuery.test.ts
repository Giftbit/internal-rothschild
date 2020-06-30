import * as chai from "chai";
import * as testUtils from "../testUtils";
import {getKnexRead, getKnexWrite} from "./connection";
import {paginateQuery} from "./paginateQuery";

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

    it("pages a simple query", async () => {
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

    it("pages a simple query paging backwards from last", async () => {
        const knex = await getKnexRead();

        const lastThirty: PaginationTest[] = await knex("PaginationTest")
            .where({
                userId: "user1"
            })
            .orderBy("id", "DESC")
            .limit(30);
        lastThirty.reverse();
        chai.assert.equal(lastThirty[lastThirty.length - 1].id, "id-999", "check that I got the last 30");

        const lastPage = await paginateQuery<PaginationTest>(
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
                last: true
            }
        );
        chai.assert.deepEqual(lastPage.body, lastThirty.slice(20, 30));

        const secondLastPage = await paginateQuery<PaginationTest>(
            knex("PaginationTest")
                .where({
                    userId: "user1"
                }),
            {
                limit: 10,
                maxLimit: 10,
                sort: null,
                before: lastPage.pagination.before,
                after: null,
                last: false
            }
        );
        chai.assert.deepEqual(secondLastPage.body, lastThirty.slice(10, 20), "secondLastPage");

        const secondLastPageNext = await paginateQuery<PaginationTest>(
            knex("PaginationTest")
                .where({
                    userId: "user1"
                }),
            {
                limit: 10,
                maxLimit: 10,
                sort: null,
                before: null,
                after: secondLastPage.pagination.after,
                last: false
            }
        );
        chai.assert.deepEqual(secondLastPageNext.body, lastPage.body, "secondLastPageNext");
    });

    it("pages a query with advanced filters", async () => {
        const knex = await getKnexRead();

        const firstThirty: PaginationTest[] = await knex("PaginationTest")
            .where({
                userId: "user1",
                c: true
            })
            .where("b", ">", 50)
            .limit(30);

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
        chai.assert.deepEqual(page1.body, firstThirty.slice(0, 10), "page1");

        const page2 = await paginateQuery(
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
        chai.assert.deepEqual(page2.body, firstThirty.slice(10, 20), "page2");

        const page3 = await paginateQuery<PaginationTest>(
            knex("PaginationTest")
                .where({
                    userId: "user1",
                    c: true
                })
                .where("b", ">", 50),
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
                    userId: "user1",
                    c: true
                })
                .where("b", ">", 50),
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
                    userId: "user1",
                    c: true
                })
                .where("b", ">", 50),
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

    it("pages a query with advanced filters paging backwards from last", async () => {
        const knex = await getKnexRead();

        const lastThirty: PaginationTest[] = await knex("PaginationTest")
            .where({
                userId: "user1",
                c: true
            })
            .where("b", ">", 50)
            .orderBy("id", "DESC")
            .limit(30);
        lastThirty.reverse();

        const lastPage = await paginateQuery<PaginationTest>(
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
                last: true
            }
        );
        chai.assert.deepEqual(lastPage.body, lastThirty.slice(20, 30));

        const secondLastPage = await paginateQuery<PaginationTest>(
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
                before: lastPage.pagination.before,
                after: null,
                last: false
            }
        );
        chai.assert.deepEqual(secondLastPage.body, lastThirty.slice(10, 20), "secondLastPage");

        const secondLastPageNext = await paginateQuery<PaginationTest>(
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
                after: secondLastPage.pagination.after,
                last: false
            }
        );
        chai.assert.deepEqual(secondLastPageNext.body, lastPage.body, "secondLastPageNext");
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

    it("pages a query with sorting on low cardinality", async () => {
        const knex = await getKnexRead();

        const firstThirty: PaginationTest[] = await knex("PaginationTest")
            .where({
                userId: "user1"
            })
            .orderBy("c")
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
                    field: "c",
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
                    field: "c",
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
                    field: "c",
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
                    field: "c",
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
                    field: "c",
                    asc: true
                },
                before: page3prev.pagination.before,
                after: null,
                last: false
            }
        );
        chai.assert.deepEqual(page3prevprev.body, page1.body, "page3prevprev");
    });

    it("pages a query with sorting paging backwards from last", async () => {
        const knex = await getKnexRead();

        const lastThirty: PaginationTest[] = await knex("PaginationTest")
            .where({
                userId: "user1"
            })
            .orderBy("b", "DESC")
            .orderBy("id", "DESC")
            .limit(30);
        lastThirty.reverse();
        chai.assert.isTrue(lastThirty[lastThirty.length - 2].b <= lastThirty[lastThirty.length - 1].b, "check that I got the last 20 thirty");

        const lastPage = await paginateQuery<PaginationTest>(
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
                last: true
            }
        );
        chai.assert.deepEqual(lastPage.body, lastThirty.slice(20, 30));

        const secondLastPage = await paginateQuery<PaginationTest>(
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
                before: lastPage.pagination.before,
                after: null,
                last: false
            }
        );
        chai.assert.deepEqual(secondLastPage.body, lastThirty.slice(10, 20), "secondLastPage");

        const secondLastPageNext = await paginateQuery<PaginationTest>(
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
                after: secondLastPage.pagination.after,
                last: false
            }
        );
        chai.assert.deepEqual(secondLastPageNext.body, lastPage.body, "secondLastPageNext");
    });

    it("pages a query with reverse sorting", async () => {
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

    it("pages a query with reverse sorting on low carinality", async () => {
        const knex = await getKnexRead();

        const firstThirty: PaginationTest[] = await knex("PaginationTest")
            .where({
                userId: "user1"
            })
            .orderBy("c", "DESC")
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
                    field: "c",
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
                    field: "c",
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
                    field: "c",
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
                    field: "c",
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
                    field: "c",
                    asc: false
                },
                before: page3prev.pagination.before,
                after: null,
                last: false
            }
        );
        chai.assert.deepEqual(page3prevprev.body, page1.body, "page3prevprev");
    });

    it("pages a query with reverse sorting paging backwards from last", async () => {
        const knex = await getKnexRead();

        const lastThirty: PaginationTest[] = await knex("PaginationTest")
            .where({
                userId: "user1"
            })
            .orderBy("b")
            .orderBy("id")
            .limit(30);
        lastThirty.reverse();
        chai.assert.isTrue(lastThirty[lastThirty.length - 2].b >= lastThirty[lastThirty.length - 1].b, "check that I got the last 20 thirty");

        const lastPage = await paginateQuery<PaginationTest>(
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
                last: true
            }
        );
        chai.assert.deepEqual(lastPage.body, lastThirty.slice(20, 30));

        const secondLastPage = await paginateQuery<PaginationTest>(
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
                before: lastPage.pagination.before,
                after: null,
                last: false
            }
        );
        chai.assert.deepEqual(secondLastPage.body, lastThirty.slice(10, 20), "secondLastPage");

        const secondLastPageNext = await paginateQuery<PaginationTest>(
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
                after: secondLastPage.pagination.after,
                last: false
            }
        );
        chai.assert.deepEqual(secondLastPageNext.body, lastPage.body, "secondLastPageNext");
    });
});
