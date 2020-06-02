import * as cassava from "cassava";
import * as testUtils from "../../utils/testUtils";
import {installRestRoutes} from "./installRestRoutes";
import chai from "chai";
import {Currency} from "../../model/Currency";
import {Transaction} from "../../model/Transaction";
import {Value} from "../../model/Value";
import {Program} from "../../model/Program";
import {Contact} from "../../model/Contact";
import {GiftbitRestError} from "giftbit-cassava-routes";

describe("whitespace handling - all resources", () => {
    const router = new cassava.Router();
    let value: Value;
    let contact: Contact;

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);
        await testUtils.createUSD(router);
        value = await testUtils.createUSDValue(router);
        const contactResp = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", {
            id: testUtils.generateId()
        });
        chai.assert.equal(contactResp.statusCode, 201, `contactResp.body=${JSON.stringify(contactResp.body)}`);
        contact = contactResp.body;
    });

    describe("contacts", () => {
        it("does not allow contactIds to be created with leading/trailing whitespace", async () => {
            const contactLeadingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/contacts", "POST", {
                id: `\t${testUtils.generateId()}`
            });
            chai.assert.equal(contactLeadingResp.statusCode, 422, `contactLeadingResp.body=${JSON.stringify(contactLeadingResp.body)}`);
            const contactTrailingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/contacts", "POST", {
                id: `${testUtils.generateId()}\n`
            });
            chai.assert.equal(contactTrailingResp.statusCode, 422, `contactTrailingResp.body=${JSON.stringify(contactTrailingResp.body)}`);
        });

        it("404s when looking up a contact by id with leading/trailing whitespace", async () => {
            const contactId = testUtils.generateId();
            const contactResp = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", {id: contactId});
            chai.assert.equal(contactResp.statusCode, 201, `contactResp.body=${JSON.stringify(contactResp.body)}`);

            const fetchLeading = await testUtils.testAuthedRequest<Contact>(router, `/v2/contacts/%20${contactId}`, "GET");
            chai.assert.equal(fetchLeading.statusCode, 404, `fetchLeading.body=${JSON.stringify(fetchLeading.body)}`);
            const fetchTrailing = await testUtils.testAuthedRequest<Contact>(router, `/v2/contacts/${contactId}%20`, "GET");
            chai.assert.equal(fetchTrailing.statusCode, 404, `fetchTrailing.body=${JSON.stringify(fetchTrailing.body)}`);
        });

        describe("FK references to contactIds", () => {
            it("does not allow values to be attached to contactIds with whitespace", async () => {
                const attachResp = await testUtils.testAuthedRequest<GiftbitRestError>(router, `/v2/contacts/${contact.id}%20/values/attach`, "POST", {
                    valueId: "irrelevant"
                });
                chai.assert.equal(attachResp.statusCode, 404, `attachResp.body=${JSON.stringify(attachResp.body)}`);
                chai.assert.equal(attachResp.body["messageCode"], "ContactNotFound", `attachResp.body=${JSON.stringify(attachResp.body)}`);
            });

            it.skip("does not transact against contactIds with whitespace", async () => {
                // todo change tx party evaluation? using json schema to validate results in a confusing error:
                //  {"message":"The POST body has 1 validation error(s):
                //  requestBody.sources[0] is not exactly one from \"lightrail\",\"stripe\",\"internal\".","statusCode":422}
                await testUtils.createUSDValue(router, {contactId: contact.id}); // 'contact not found' is indistinguishable from 'contact has no attached values' in checkout failures
                const txResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/transactions/checkout", "POST", {
                    id: testUtils.generateId(),
                    currency: "USD",
                    lineItems: [{unitPrice: 1}],
                    sources: [{
                        rail: "lightrail",
                        contactId: `${contact.id} `
                    }]
                });
                console.log(JSON.stringify(txResp.body));
                chai.assert.equal(txResp.statusCode, 409, `txResp.body=${JSON.stringify(txResp.body)}`);
            });

            it("does not return values when searching by contactId with whitespace", async () => {
                await testUtils.createUSDValue(router, {contactId: contact.id});
                const fetchResp = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?contactId=${contact.id}%20`, "GET");
                chai.assert.equal(fetchResp.statusCode, 200, `fetchResp.body=${JSON.stringify(fetchResp.body)}`);
                chai.assert.equal(fetchResp.body.length, 0, `fetchResp.body=${JSON.stringify(fetchResp.body)}`);
            });

            it("does not return transactions when searching by contactId with whitespace", async () => {
                await testUtils.createUSDValue(router, {balance: 1000, contactId: contact.id});
                await testUtils.createUSDCheckout(router, {
                    sources: [{
                        rail: "lightrail",
                        contactId: contact.id
                    }]
                }, false);
                const fetchResp = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?contactId=${contact.id}%20`, "GET");
                chai.assert.equal(fetchResp.statusCode, 200, `fetchResp.body=${JSON.stringify(fetchResp.body)}`);
                chai.assert.equal(fetchResp.body.length, 0, `fetchResp.body=${JSON.stringify(fetchResp.body)}`);
            });
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

    describe("currencies", () => {
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

            const fetchLeading = await testUtils.testAuthedRequest<cassava.RestError>(router, `/v2/currencies/%20${resp.body.code}`, "GET");
            chai.assert.equal(fetchLeading.statusCode, 404, `fetchLeading.body=${JSON.stringify(fetchLeading.body)}`);
            const fetchTrailing = await testUtils.testAuthedRequest<cassava.RestError>(router, `/v2/currencies/${resp.body.code}%20`, "GET");
            chai.assert.equal(fetchTrailing.statusCode, 404, `fetchTrailing.body=${JSON.stringify(fetchTrailing.body)}`);
        });

        describe("FK references to currency codes", () => {
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
                chai.assert.equal(txLeadingResp.statusCode, 422, `txLeadingResp.body=${JSON.stringify(txLeadingResp.body)}`);
                const txTrailingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/transactions/credit", "POST", {
                    id: testUtils.generateId(),
                    currency: "USD ",
                    amount: 1,
                    destination: {
                        rail: "lightrail",
                        valueId: value.id
                    }
                });
                chai.assert.equal(txTrailingResp.statusCode, 422, `txTrailingResp.body=${JSON.stringify(txTrailingResp.body)}`);
            });

            it("does not allow programs to use currency codes with whitespace", async () => {
                const programLeadingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/programs", "POST", {
                    id: testUtils.generateId(),
                    name: "Leading whitespace test",
                    currency: " USD"
                });
                chai.assert.equal(programLeadingResp.statusCode, 422, `programLeadingResp.body=${JSON.stringify(programLeadingResp.body)}`);
                const programTrailingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/programs", "POST", {
                    id: testUtils.generateId(),
                    name: "Trailing whitespace test",
                    currency: "USD "
                });
                chai.assert.equal(programTrailingResp.statusCode, 422, `programTrailingResp.body=${JSON.stringify(programTrailingResp.body)}`);
            });

            it("does not allow values to use currency codes with whitespace", async () => {
                const valueLeadingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/values", "POST", {
                    id: testUtils.generateId(),
                    currency: " USD",
                    balance: 50
                });
                chai.assert.equal(valueLeadingResp.statusCode, 422, `valueLeadingResp.body=${JSON.stringify(valueLeadingResp.body)}`);
                const valueTrailingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/values", "POST", {
                    id: testUtils.generateId(),
                    currency: "USD ",
                    balance: 50
                });
                chai.assert.equal(valueTrailingResp.statusCode, 422, `valueTrailingResp.body=${JSON.stringify(valueTrailingResp.body)}`);
            });

            it("does not return transactions when searching by currency code with whitespace", async () => {
                await testUtils.createUSDCheckout(router, {}, false);
                const fetchTxResp = await testUtils.testAuthedRequest<Transaction[]>(router, "/v2/transactions?currency=USD", "GET");
                chai.assert.equal(fetchTxResp.statusCode, 200, `fetchTxResp.body=${JSON.stringify(fetchTxResp.body)}`);
                chai.assert.isAtLeast(fetchTxResp.body.length, 1);

                const fetchTxLeadingResp = await testUtils.testAuthedRequest<Transaction[]>(router, "/v2/transactions?currency=%20USD", "GET");
                chai.assert.equal(fetchTxLeadingResp.statusCode, 200, `fetchTxLeadingResp.body=${JSON.stringify(fetchTxLeadingResp.body)}`);
                chai.assert.equal(fetchTxLeadingResp.body.length, 0, `fetchTxLeadingResp.body=${JSON.stringify(fetchTxLeadingResp.body)}`);
                const fetchTxTrailingResp = await testUtils.testAuthedRequest<Transaction[]>(router, "/v2/transactions?currency=USD%20", "GET");
                chai.assert.equal(fetchTxTrailingResp.statusCode, 200, `fetchTxTrailingResp.body=${JSON.stringify(fetchTxTrailingResp.body)}`);
                chai.assert.equal(fetchTxTrailingResp.body.length, 0, `fetchTxTrailingResp.body=${JSON.stringify(fetchTxTrailingResp.body)}`);
            });

            it("does not return programs when searching by currency code with whitespace", async () => {
                const program = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", {
                    id: testUtils.generateId(),
                    name: "example",
                    currency: "USD"
                });
                const fetchProgramResp = await testUtils.testAuthedRequest<Program[]>(router, "/v2/programs?currency=USD", "GET");
                chai.assert.equal(fetchProgramResp.statusCode, 200, `fetchProgramResp.body=${JSON.stringify(fetchProgramResp.body)}`);
                chai.assert.isAtLeast(fetchProgramResp.body.length, 1);

                const fetchProgramsLeadingResp = await testUtils.testAuthedRequest<Program[]>(router, "/v2/programs?currency=%20USD", "GET");
                chai.assert.equal(fetchProgramsLeadingResp.statusCode, 200, `fetchProgramsLeadingResp.body=${JSON.stringify(fetchProgramsLeadingResp.body)}`);
                chai.assert.equal(fetchProgramsLeadingResp.body.length, 0, `fetchProgramsLeadingResp.body=${JSON.stringify(fetchProgramsLeadingResp.body)}`);
                const fetchProgramsTrailingResp = await testUtils.testAuthedRequest<Program[]>(router, "/v2/programs?currency=USD%20", "GET");
                chai.assert.equal(fetchProgramsTrailingResp.statusCode, 200, `fetchProgramsTrailingResp.body=${JSON.stringify(fetchProgramsTrailingResp.body)}`);
                chai.assert.equal(fetchProgramsTrailingResp.body.length, 0, `fetchProgramsTrailingResp.body=${JSON.stringify(fetchProgramsTrailingResp.body)}`);
            });

            it("does not return values when searching by currency code with whitespace", async () => {
                const fetchValuesResp = await testUtils.testAuthedRequest<Value[]>(router, "/v2/values?currency=USD", "GET");
                chai.assert.equal(fetchValuesResp.statusCode, 200, `fetchValuesResp.body=${JSON.stringify(fetchValuesResp.body)}`);
                chai.assert.isAtLeast(fetchValuesResp.body.length, 1);

                const fetchValuesLeadingResp = await testUtils.testAuthedRequest<Value[]>(router, "/v2/values?currency=%20USD", "GET");
                chai.assert.equal(fetchValuesLeadingResp.statusCode, 200, `fetchValuesLeadingResp.body=${JSON.stringify(fetchValuesLeadingResp.body)}`);
                chai.assert.equal(fetchValuesLeadingResp.body.length, 0, `fetchValuesLeadingResp.body=${JSON.stringify(fetchValuesLeadingResp.body)}`);
                const fetchValuesTrailingResp = await testUtils.testAuthedRequest<Value[]>(router, "/v2/values?currency=USD%20", "GET");
                chai.assert.equal(fetchValuesTrailingResp.statusCode, 200, `fetchValuesTrailingResp.body=${JSON.stringify(fetchValuesTrailingResp.body)}`);
                chai.assert.equal(fetchValuesTrailingResp.body.length, 0, `fetchValuesTrailingResp.body=${JSON.stringify(fetchValuesTrailingResp.body)}`);
            });
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
        it("does not allow transactionIds to be created with leading/trailing whitespace", async () => {
            const txLeadingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/transactions/checkout", "POST", {
                id: `\n${testUtils.generateId()}`,
                currency: "USD",
                lineItems: [{unitPrice: 1}],
                sources: [{rail: "lightrail", valueId: value.id}]
            });
            chai.assert.equal(txLeadingResp.statusCode, 422, `txLeadingResp.body=${JSON.stringify(txLeadingResp.body)}`);

            const txTrailingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/transactions/checkout", "POST", {
                id: `${testUtils.generateId()}\n`,
                currency: "USD",
                lineItems: [{unitPrice: 1}],
                sources: [{rail: "lightrail", valueId: value.id}]
            });
            chai.assert.equal(txTrailingResp.statusCode, 422, `txTrailingResp.body=${JSON.stringify(txTrailingResp.body)}`);
        });

        it("404s when looking up a transaction by id with leading/trailing whitespace", async () => {
            const txId = testUtils.generateId();
            const txResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
                id: txId,
                currency: "USD",
                lineItems: [{unitPrice: 1}],
                sources: [{rail: "lightrail", valueId: value.id}]
            });
            chai.assert.equal(txResp.statusCode, 201, `txResp.body=${JSON.stringify(txResp.body)}`);
            chai.assert.equal(txResp.body.id, txId, `txResp.body=${JSON.stringify(txResp.body)}`);

            const fetchLeadingResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/%20${txId}`, "GET");
            chai.assert.equal(fetchLeadingResp.statusCode, 404, `fetchLeadingResp.body=${JSON.stringify(fetchLeadingResp.body)}`);
            const fetchTrailingResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${txId}%20`, "GET");
            chai.assert.equal(fetchTrailingResp.statusCode, 404, `fetchTrailingResp.body=${JSON.stringify(fetchTrailingResp.body)}`);
        });
    });
});
