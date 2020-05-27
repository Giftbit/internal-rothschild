import * as cassava from "cassava";
import * as testUtils from "../../utils/testUtils";
import {installRestRoutes} from "./installRestRoutes";
import chai from "chai";
import {Currency} from "../../model/Currency";
import {Transaction} from "../../model/Transaction";
import {Value} from "../../model/Value";
import {Program} from "../../model/Program";

describe("whitespace handling - all resources", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);
    });

    describe("contacts", () => {
        it("does not allow contactIds to be created with leading/trailing whitespace");
        it("404s when looking up a contact by id with leading/trailing whitespace");

        describe("emails & names", () => {
            it("does not allow emails to be created with leading/trailing whitespace");

            // the following tests document known behaviour:
            // ideally whitespace handling would be consistent for all string properties
            // but at this time it is not worth the implementation effort
            it("successfully fetches contact when searching by email with trailing whitespace");
            it("successfully fetches contact when searching by firstName with trailing whitespace");
            it("successfully fetches contact when searching by lastName with trailing whitespace");
        });

        describe("FK references to contactIds", () => {
            it("does not allow values to be attached to contactIds with whitespace");
            it("does not transact against contactIds with whitespace");
            it("does not return values when searching by contactId with whitespace");
            it("does not return transactions when searching by contactId with whitespace");
        });
    });

    describe("values", () => {
        describe("valueIds", () => {
            it("does not allow valueIds to be created with leading/trailing whitespace");
            it("404s when looking up a value by id with leading/trailing whitespace");

            describe("FK references to valueIds", () => {
                it("does not attach valueIds wih whitespace");
                it("does not transact against valueIds with whitespace");
                it("does not return contacts when searching by valueId with whitespace");
                it("does not return transactions when searching by valueId with whitespace");
            });
        });

        describe("codes", () => {
            it("does not allow codes to be create with leading/trailing whitespace");
            it("does not allow leading/trailing whitespace in code-generation params");

            it("transacts against value by code with leading/trailing whitespace");
            it("fetches value by code with leading/trailing whitespace");
        });
    });

    describe.only("currencies", () => {
        const currWithLeading: Partial<Currency> = {
            name: "Whitespace test currency",
            symbol: "$",
            decimalPlaces: 2,
            code: " abc"
        };
        const currWithTrailing: Partial<Currency> = {
            name: "Whitespace test currency",
            symbol: "$",
            decimalPlaces: 2,
            code: "abc "
        };

        it("does not allow currency codes to be created with leading/trailing whitespace", async () => {
            const resp1 = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/currencies", "POST", currWithLeading);
            chai.assert.equal(resp1.statusCode, 422, JSON.stringify(resp1.body));

            const resp2 = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/currencies", "POST", currWithTrailing);
            chai.assert.equal(resp2.statusCode, 422, JSON.stringify(resp2.body));
        });

        it("404s fetching a currency by code with leading/trailing whitespace", async () => {
            const resp = await testUtils.testAuthedRequest<Currency>(router, "/v2/currencies", "POST", {
                ...currWithTrailing,
                code: "abc"
            });
            chai.assert.equal(resp.statusCode, 201, `resp.body=${JSON.stringify(resp.body)}`);

            const fetchLeading = await testUtils.testAuthedRequest<Currency[]>(router, `/v2/currencies/%20${resp.body.code}`, "GET");
            chai.assert.equal(fetchLeading.statusCode, 404, `fetchLeading.body=${JSON.stringify(fetchLeading.body)}`);

            const fetchTrailing = await testUtils.testAuthedRequest<Currency[]>(router, `/v2/currencies/${resp.body.code}%20`, "GET");
            chai.assert.equal(fetchTrailing.statusCode, 404, `fetchTrailing.body=${JSON.stringify(fetchTrailing.body)}`);
        });

        describe("FK references to currency codes", () => {
            let value: Value;

            before(async () => {
                await testUtils.createUSD(router);
                value = await testUtils.createUSDValue(router);
            });

            it("does not allow transactions to use currency codes with whitespace", async () => {
                const txLeadingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/transactions/credit", "POST", {
                    id: testUtils.generateId(),
                    currency: " USD",
                    amount: 1,
                    destination: {
                        rail: "lightrail",
                        valueId: value.id
                    }
                });
                chai.assert.equal(txLeadingResp.statusCode, 409, `txLeadingResp.body=${JSON.stringify(txLeadingResp.body)}`);
                const txTrailingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/transactions/credit", "POST", {
                    id: testUtils.generateId(),
                    currency: "USD ",
                    amount: 1,
                    destination: {
                        rail: "lightrail",
                        valueId: value.id
                    }
                });
                chai.assert.equal(txTrailingResp.statusCode, 409, `txTrailingResp.body=${JSON.stringify(txTrailingResp.body)}`);
            });

            it("does not allow programs to use currency codes with whitespace", async () => {
                const programLeadingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/programs", "POST", {
                    id: testUtils.generateId(),
                    name: "Leading whitespace test",
                    currency: " USD"
                });
                chai.assert.equal(programLeadingResp.statusCode, 409, `programLeadingResp.body=${JSON.stringify(programLeadingResp.body)}`);
                const programTrailingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/programs", "POST", {
                    id: testUtils.generateId(),
                    name: "Trailing whitespace test",
                    currency: "USD "
                });
                chai.assert.equal(programTrailingResp.statusCode, 409, `programTrailingResp.body=${JSON.stringify(programTrailingResp.body)}`);
            });

            it("does not allow values to use currency codes with whitespace", async () => {
                const valueLeadingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/programs", "POST", {
                    id: testUtils.generateId(),
                    currency: " USD",
                    balance: 50
                });
                chai.assert.equal(valueLeadingResp.statusCode, 409, `valueLeadingResp.body=${JSON.stringify(valueLeadingResp.body)}`);
                const valueTrailingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/programs", "POST", {
                    id: testUtils.generateId(),
                    currency: "USD ",
                    balance: 50
                });
                chai.assert.equal(valueTrailingResp.statusCode, 409, `valueTrailingResp.body=${JSON.stringify(valueTrailingResp.body)}`);
            });

            it("does not return transactions when searching by currency code with whitespace", async () => {
                await testUtils.createUSDCheckout(router, {}, false);
                const fetchTxResp = await testUtils.testAuthedRequest<Transaction[]>(router, "/v2/transactions?currency=USD", "GET");
                chai.assert.equal(fetchTxResp.statusCode, 200, `fetchTxResp.body=${JSON.stringify(fetchTxResp.body)}`);
                chai.assert.isAtLeast(fetchTxResp.body.length, 1);

                const fetchTxLeadingResp = await testUtils.testAuthedRequest<Transaction[]>(router, "/v2/transactions?currency=%20USD", "GET");
                chai.assert.equal(fetchTxLeadingResp.statusCode, 200, `fetchTxLeadingResp.body=${JSON.stringify(fetchTxLeadingResp.body)}`);
                const fetchTxTrailingResp = await testUtils.testAuthedRequest<Transaction[]>(router, "/v2/transactions?currency=USD%20", "GET");
                chai.assert.equal(fetchTxTrailingResp.statusCode, 200, `fetchTxTrailingResp.body=${JSON.stringify(fetchTxTrailingResp.body)}`);
            });

            it("does not return programs when searching by currency code with whitespace", async () => {
                const program = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", {
                    id: testUtils.generateId(),
                    name: "example",
                    currency: "USD"
                });
                const fetchProgramResp = await testUtils.testAuthedRequest<Program[]>(router, "/v2/programs", "GET");
                chai.assert.equal(fetchProgramResp.statusCode, 200, `fetchProgramResp.body=${JSON.stringify(fetchProgramResp.body)}`);
                chai.assert.isAtLeast(fetchProgramResp.body.length, 1);

                const fetchProgramsLeadingResp = await testUtils.testAuthedRequest<Program[]>(router, "/v2/programs?currency=%20USD", "GET");
                chai.assert.equal(fetchProgramsLeadingResp.statusCode, 200, `fetchProgramsLeadingResp.body=${JSON.stringify(fetchProgramsLeadingResp.body)}`);
                const fetchProgramsTrailingResp = await testUtils.testAuthedRequest<Program[]>(router, "/v2/programs?currency=USD%20", "GET");
                chai.assert.equal(fetchProgramsTrailingResp.statusCode, 200, `fetchProgramsTrailingResp.body=${JSON.stringify(fetchProgramsTrailingResp.body)}`);

            });

            it("does not return values when searching by currency code with whitespace");
        });
    });

    describe("programs", () => {
        it("does not allow programIds to be created with leading/trailing whitespace");
        it("404s when looking up a program by id with leading/trailing whitespace");

        describe("FK references to programIds", () => {
            it("does not allow values to be created from programIds with whitespace");
            it("does not return values when searching by programId with whitespace");

            it("does not allow issuances to be created from programIds with whitespace");
            // todo: is this a thing?
            it("does not return issuances when searching by programId with whitespace");
        });
    });

    describe("issuances", () => {
        it("does not allow issuanceIds to be created with leading/trailing whitespace");
        it("404s when looking up an issuance by id with leading/trailing whitespace");

        describe("FK references to issuanceIds", () => {
            // todo: do these exist?
        });
    });

    describe("transactions", () => {
        it("does not allow transactionIds to be created with leading/trailing whitespace");
        it("404s when looking up a transaction by id with leading/trailing whitespace");

        describe("FK references to transactionIds", () => {
            // todo: do these exist?
        });
    });
});
