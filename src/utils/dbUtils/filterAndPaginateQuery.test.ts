import * as chai from "chai";
import * as testUtils from "../testUtils";
import {FilterQueryOptions} from "./filterQuery";
import {PaginationParams} from "../../model/Pagination";
import {filterAndPaginateQuery} from "./index";
import {getKnexRead, getKnexWrite} from "./connection";

describe("filterAndPaginateQuery", () => {

    interface Province {
        id: string;
        population: number;
        area: number; // km^2
    }

    interface City {
        id: string;
        provinceId: string;
        population: number;
        area: number; // km^2
    }

    const provinceFilterQueryOptions: FilterQueryOptions = {
        properties: {
            id: {
                type: "string",
                operators: ["eq", "in"]
            },
            population: {
                type: "number",
                operators: ["lt", "lte", "gt", "gte", "eq", "ne", "in"]
            },
            area: {
                type: "number",
                operators: ["lt", "lte", "gt", "gte", "eq", "ne", "in"]
            }
        }
    };

    const provinces: Province[] = [
        {
            id: "Alberta",
            population: 4067175,
            area: 661848
        },
        {
            id: "British Columbia",
            population: 4648055,
            area: 944735
        },
        {
            id: "Ontario",
            population: 13448494,
            area: 1076395
        },
        {
            id: "Quebec",
            population: 8164361,
            area: 1542056
        }
    ];

    const alberta: Province = provinces.find(p => p.id === "Alberta");
    const britishColumbia: Province = provinces.find(p => p.id === "British Columbia");
    const ontario: Province = provinces.find(p => p.id === "Ontario");
    const quebec: Province = provinces.find(p => p.id === "Quebec");

    const cities: City[] = [
        {
            id: "Victoria",
            provinceId: "British Columbia",
            population: 80017,
            area: 19
        },
        {
            id: "Vancouver",
            provinceId: "British Columbia",
            population: 603502,
            area: 115
        },

        {
            id: "Calgary",
            provinceId: "Alberta",
            population: 1096833,
            area: 825
        },
        {
            id: "Edmonton",
            provinceId: "Alberta",
            population: 812201,
            area: 684
        },

        {
            id: "Toronto",
            provinceId: "Ontario",
            population: 2731571,
            area: 630
        },
        {
            id: "Ottawa",
            provinceId: "Ontario",
            population: 934243,
            area: 2790
        },

        {
            id: "Montreal",
            provinceId: "Quebec",
            population: 1649519,
            area: 365
        },
        {
            id: "Quebec City",
            provinceId: "Quebec",
            population: 516622,
            area: 454
        }
    ];

    const pagination: PaginationParams = {
        limit: 100,
        maxLimit: 1000,
        sort: null,
        before: null,
        after: null,
        last: false
    };

    before(async () => {
        await testUtils.resetDb();

        const knex = await getKnexWrite();
        await knex.raw(`
            CREATE TABLE rothschild.Province
            (
                id         VARCHAR(32) NOT NULL,
                population INT         NOT NULL,
                area       INT         NOT NULL,
                PRIMARY KEY pk_id (id)
            );
        `);
        await knex.raw(`
            CREATE TABLE rothschild.City
            (
                id         VARCHAR(32) NOT NULL,
                provinceId VARCHAR(32) NOT NULL,
                population INT         NOT NULL,
                area       INT         NOT NULL,
                PRIMARY KEY pk_id (id),
                CONSTRAINT fk_province FOREIGN KEY (provinceId) REFERENCES rothschild.Province (id)
            )
        `);

        await knex.into("Province").insert(provinces);
        let res = await knex.select().table("Province");
        chai.assert.equal(res.length, 4);

        await knex.into("City").insert(cities);
        res = await knex.select().table("City");
        chai.assert.equal(res.length, 8);
    });

    it("join: find province that Calgary belongs to", async () => {
        const knex = await getKnexRead();
        const query = knex("Province")
            .select("Province.*")
            .join("City", {"Province.id": "City.provinceId"})
            .where("City.id", "=", "Calgary");
        const results: Province[] = await query;
        chai.assert.equal(results.length, 1);
        chai.assert.deepEqual(results[0], alberta);
    });

    it("filterAndPaginateQuery: find provinces that have cities with population over 1 million", async () => {
        const knex = await getKnexRead();
        const query = knex("Province")
            .select("Province.*")
            .join("City", {"Province.id": "City.provinceId"})
            .where("City.population", ">", 1000000);


        const results = await filterAndPaginateQuery<Province>(
            query,
            {},
            {
                ...provinceFilterQueryOptions,
                tableName: "Province"
            },
            pagination,
        );
        chai.assert.equal(results.body.length, 3);
        chai.assert.sameDeepMembers(results.body, [alberta, ontario, quebec]);
    });

    it("filterAndPaginateQuery: find provinces that have area less than 1 million square kms", async () => {
        const knex = await getKnexRead();
        const query = knex("Province");

        const filterParams: { [key: string]: string } = {
            "area.lt": "1000000"
        };

        const results = await filterAndPaginateQuery<Province>(
            query,
            filterParams,
            {
                ...provinceFilterQueryOptions,
                tableName: "Province"
            },
            pagination,
        );
        chai.assert.equal(results.body.length, 2);
        chai.assert.sameDeepMembers(results.body, [alberta, britishColumbia]);
    });

    describe("filterAndPaginateQuery: find provinces that have area less than 1 million square kms and city area > 0", () => {
        it("without tableName argument throws exception", async () => {
            const knex = await getKnexRead();
            const query = knex("Province")
                .select("Province.*")
                .join("City", {"Province.id": "City.provinceId"})
                .where("City.area", ">", 0);

            const filterParams: { [key: string]: string } = {
                "area.lt": "1000000"
            };
            // query WITHOUT tableName argument - should throw an exception
            try {
                await filterAndPaginateQuery<Province>(
                    query,
                    filterParams,
                    provinceFilterQueryOptions,
                    pagination,
                );
                chai.assert.fail("If the query doesn't throw an exception this will fail.");
            } catch (err) {
                // err was thrown so tests passes.
            }

        });

        it("with tableName succeeds", async () => {
            const knex = await getKnexRead();
            let query = knex("Province")
                .select("Province.*")
                .join("City", {"Province.id": "City.provinceId"})
                .where("City.area", ">", 0);

            const filterParams: { [key: string]: string } = {
                "area.lt": "1000000"
            };

            let results = await filterAndPaginateQuery<Province>(
                query,
                filterParams,
                {
                    ...provinceFilterQueryOptions,
                    tableName: "Province"
                },
                pagination,
            );
            chai.assert.equal(results.body.length, 4);
            // since both provinces have 2 cities that fit the criteria you end up getting each province twice.
            chai.assert.sameDeepMembers(results.body, [alberta, alberta, britishColumbia, britishColumbia]);

            // adjust query to return unique provinces
            query = knex("Province")
                .distinct()
                .select("Province.*")
                .join("City", {"Province.id": "City.provinceId"})
                .where("City.area", ">", 0);

            results = await filterAndPaginateQuery<Province>(
                query,
                filterParams,
                {
                    ...provinceFilterQueryOptions,
                    tableName: "Province"
                },
                pagination,
            );
            chai.assert.equal(results.body.length, 2);
            chai.assert.sameDeepMembers(results.body, [alberta, britishColumbia]);
        });
    });


    it("filterAndPaginateQuery: order provinces by population descending", async () => {
        const knex = await getKnexRead();
        const query = knex("Province");

        // query WITHOUT tableName argument - throws exception
        let results = await filterAndPaginateQuery<Province>(
            query,
            {},
            provinceFilterQueryOptions,
            {
                ...pagination,
                sort: {
                    field: "population",
                    asc: false
                }
            },
        );
        chai.assert.equal(results.body.length, 4);
        chai.assert.sameDeepOrderedMembers(results.body, [ontario, quebec, britishColumbia, alberta]);

        // query WITH tableName argument
        results = await filterAndPaginateQuery<Province>(
            query,
            {},
            {
                ...provinceFilterQueryOptions,
                tableName: "Province"
            },
            {
                ...pagination,
                sort: {
                    field: "population",
                    asc: false
                }
            },
        );
        chai.assert.equal(results.body.length, 4);
        chai.assert.sameDeepOrderedMembers(results.body, [ontario, quebec, britishColumbia, alberta]);

        it("filterAndPaginateQuery: filter for provinces that have city with area over 500 and order provinces by area asc", async () => {
            const knex = await getKnexRead();
            const query = knex("Province")
                .select("Province.*")
                .join("City", {"Province.id": "City.provinceId"})
                .where("City.population", ">", 1000000);

            describe("query WITHOUT tableName argument", async () => {
                const results = await filterAndPaginateQuery<Province>(
                    query,
                    {},
                    provinceFilterQueryOptions,
                    {
                        ...pagination,
                        sort: {
                            field: "area",
                            asc: true
                        }
                    },
                );
                chai.assert.equal(results.body.length, 4);
                chai.assert.sameDeepOrderedMembers(results.body, [ontario, quebec, britishColumbia, alberta]);
            });
            describe("query WITH tableName argument", async () => {
                const results = await filterAndPaginateQuery<Province>(
                    query,
                    {},
                    {
                        ...provinceFilterQueryOptions,
                        tableName: "Province"
                    },
                    {
                        ...pagination,
                        sort: {
                            field: "population",
                            asc: false
                        }
                    },
                );
                chai.assert.equal(results.body.length, 4);
                chai.assert.sameDeepOrderedMembers(results.body, [ontario, quebec, britishColumbia, alberta]);
            });
        });
    });
});
