import {getKnexRead, getKnexWrite} from "./connection";
import * as testUtils from "../testUtils";
import {FilterQueryOptions} from "./filterQuery";
import * as chai from "chai";
import {filterAndPaginateQuery} from "./index";
import {PaginationParams} from "../../model/Pagination";

describe.only("filterQuery()", () => {

    interface Airplane {
        id: string;
        model: string;
        capacity: number;
        firstFlight: Date;
    }

    interface Flight {
        id: string;
        to: string;
        airplaneId: string;
        from: string;
    }

    const airplaneQueryOptions: FilterQueryOptions = {
        properties: {
            id: {
                type: "string",
                operators: ["eq", "in"]
            },
            model: {
                type: "string",
                operators: ["eq", "in"]
            },
            capacity: {
                type: "number",
                operators: ["lt", "lte", "gt", "gte", "eq", "ne", "in"]
            },
            firstFlight: {
                type: "Date",
                operators: ["eq", "gt", "gte", "lt", "lte", "ne"]
            }
        }
    };

    const flightQueryOptions: FilterQueryOptions = {
        properties: {
            id: {
                type: "string",
                operators: ["eq", "in"]
            },
            airplaneId: {
                type: "string",
                operators: ["eq", "in"]
            },
            from: {
                type: "string",
                operators: ["eq", "in"]
            },
            to: {
                type: "string",
                operators: ["eq", "in"]
            }
        }
    };

    const airplanes: Airplane[] = [
        {
            id: "1",
            model: "boeing-737",
            capacity: 215,
            firstFlight: new Date("1967-04-09")
        },
        {
            id: "2",
            model: "boeing-747",
            capacity: 605,
            firstFlight: new Date("1969-02-09")
        },
        {
            id: "3",
            model: "airbus-a300",
            capacity: 130,
            firstFlight: new Date("1972-10-28")
        },
        {
            id: "4",
            model: "airbus-310",
            capacity: 187,
            firstFlight: new Date("1982-04-03")
        }
    ];

    const cities = {
        calgary: "calgary",
        edmonton: "edmonton",
        toronto: "toronoto",
        vancouver: "vancouver",
        victoria: "victoria"
    };

    const flights: Flight[] = [
        // airplane 1: calgary -> victoria -> vancouver -> calgary
        {
            id: "1",
            airplaneId: "1",
            from: cities.calgary,
            to: cities.victoria,
        },
        {
            id: "2",
            airplaneId: "1",
            from: cities.victoria,
            to: cities.vancouver,
        },
        {
            id: "3",
            airplaneId: "1",
            from: cities.vancouver,
            to: cities.calgary,
        },

        // airplane 2: vancouver -> toronto -> vancouver
        {
            id: "4",
            airplaneId: "2",
            from: cities.vancouver,
            to: cities.toronto,
        },
        {
            id: "5",
            airplaneId: "2",
            from: cities.toronto,
            to: cities.vancouver,
        },

        // airplane 3: edmonton -> calgary -> vancouver -> edmonton
        {
            id: "6",
            airplaneId: "3",
            from: cities.edmonton,
            to: cities.calgary,
        },
        {
            id: "7",
            airplaneId: "3",
            from: cities.calgary,
            to: cities.vancouver,
        },
        {
            id: "8",
            airplaneId: "3",
            from: cities.vancouver,
            to: cities.edmonton,
        },

        // airplane 4: edmonton -> toronto -> edmonton
        {
            id: "9",
            airplaneId: "4",
            from: cities.edmonton,
            to: cities.toronto,
        },
        {
            id: "10",
            airplaneId: "4",
            from: cities.toronto,
            to: cities.edmonton,
        }
    ];

    before(async () => {
        await testUtils.resetDb();

        const knex = await getKnexWrite();
        await knex.raw(`
            CREATE TABLE rothschild.Airplanes (
              id          VARCHAR(32) NOT NULL,
              model       VARCHAR(32) NOT NULL,
              capacity    INT         NOT NULL,
              firstFlight DATETIME    NOT NULL,
              PRIMARY KEY pk_airplane_id (id)
            );
        `);
        await knex.raw(`
            CREATE TABLE rothschild.Flights (
              id           VARCHAR(32) NOT NULL,
              airplaneId   VARCHAR(32) NOT NULL,
              \`from\`     VARCHAR(32) NOT NULL,
              \`to\`       VARCHAR(32) NOT NULL,
              PRIMARY KEY  pk_flight_id (id),
              CONSTRAINT fk_airplane FOREIGN KEY (airplaneId) REFERENCES rothschild.Airplanes (id)
            )
        `);


        await knex.into("Airplanes").insert(airplanes);

        let res = await knex.select().table("Airplanes");
        console.log(JSON.stringify(res));
        chai.assert.equal(res.length, 4);

        await knex.into("Flights").insert(flights);

        res = await knex.select().table("Flights");
        console.log(JSON.stringify(res));
        chai.assert.equal(res.length, 10);
    });

    it("join: find airplanes that go to victoria", async () => {
        const knex = await getKnexRead();
        let query = await knex("Airplanes")
            .select("Airplanes.*")
            .join("Flights", {"Airplanes.id": "Flights.airplaneId"})
            .where("Flights.from", "=", cities.victoria);
        const results: Airplane[] = await query;
        chai.assert.equal(results.length, 1);
        chai.assert.deepEqual(results[0], airplanes[0])
    });

    it("join: find airplanes that go to toronto", async () => {
        const knex = await getKnexRead();
        let query = await knex("Airplanes")
            .select("Airplanes.*")
            .join("Flights", {"Airplanes.id": "Flights.airplaneId"})
            .where("Flights.to", "=", cities.toronto);
        const results: Airplane[] = await query;
        chai.assert.equal(results.length, 2);
        chai.assert.sameDeepMembers(results, [airplanes[1], airplanes[3]])
    });

    it("filterQuery with join", async () => {
        const knex = await getKnexRead();
        let query = await knex("Airplanes")
            .select("Airplanes.*")
            .join("Flights", {"Airplanes.id": "Flights.airplaneId"})
            .where("Flights.to", "=", cities.toronto);

        const pagination: PaginationParams = {
            limit: 100,
            maxLimit: 1000,
            sort: null,
            before: null,
            after: null,
            last: false
        };
        const results = await filterAndPaginateQuery<Airplane>(
            query,
            {},
            {
                ...airplaneQueryOptions,
                tableName: "Airplanes"
            },
            pagination,
        );
        console.log(JSON.stringify(results));
    });

});
