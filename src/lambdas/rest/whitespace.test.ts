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
import {setCodeCryptographySecrets} from "../../utils/testUtils";

describe("whitespace handling - all resources", () => {
    const router = new cassava.Router();
    let value: Value;
    let contact: Contact;

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);
        await testUtils.createUSD(router);

        testUtils.setCodeCryptographySecrets();
        const code = "ABCDEF";
        await testUtils.createUSDValue(router, {code});
        const fetchValueResp = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?code=${code}&showCode=true`, "GET");
        chai.assert.equal(fetchValueResp.statusCode, 200, `fetchValueResp.body=${JSON.stringify(fetchValueResp.body)}`);
        chai.assert.equal(fetchValueResp.body[0].code, code, `fetchValueResp.body=${JSON.stringify(fetchValueResp.body)}`);
        value = fetchValueResp.body[0];

        const contactResp = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", {
            id: testUtils.generateId()
        });
        chai.assert.equal(contactResp.statusCode, 201, `contactResp.body=${JSON.stringify(contactResp.body)}`);
        contact = contactResp.body;
    });

    describe("contacts", () => {
        it("422s creating contactIds with leading/trailing whitespace", async () => {
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
            it("404s attaching values to contactIds with whitespace", async () => {
                const attachResp = await testUtils.testAuthedRequest<GiftbitRestError>(router, `/v2/contacts/${contact.id}%20/values/attach`, "POST", {
                    valueId: "irrelevant"
                });
                chai.assert.equal(attachResp.statusCode, 404, `attachResp.body=${JSON.stringify(attachResp.body)}`);
                chai.assert.equal(attachResp.body["messageCode"], "ContactNotFound", `attachResp.body=${JSON.stringify(attachResp.body)}`);
            });

            it("does not transact against contactIds with whitespace", async () => {
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
                chai.assert.equal(txResp.statusCode, 409, `txResp.body=${JSON.stringify(txResp.body)}`);
                chai.assert.equal(txResp.body["messageCode"], "InsufficientBalance", `txResp.body=${JSON.stringify(txResp.body)}`);
            });

            it("does not find values when searching by contactId with whitespace", async () => {
                await testUtils.createUSDValue(router, {contactId: contact.id});
                const fetchResp = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?contactId=${contact.id}%20`, "GET");
                chai.assert.equal(fetchResp.statusCode, 200, `fetchResp.body=${JSON.stringify(fetchResp.body)}`);
                chai.assert.equal(fetchResp.body.length, 0, `fetchResp.body=${JSON.stringify(fetchResp.body)}`);
            });

            it("does not find transactions when searching by contactId with whitespace", async () => {
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
            it("422s creating valueIds with leading/trailing whitespace", async () => {
                const createLeadingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/values", "POST", {
                    id: `\t${testUtils.generateId()}`,
                    currency: "USD",
                    balance: 1
                });
                chai.assert.equal(createLeadingResp.statusCode, 422, `createLeadingResp.body=${JSON.stringify(createLeadingResp.body)}`);

                const createTrailingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/values", "POST", {
                    id: `${testUtils.generateId()}\n`,
                    currency: "USD",
                    balance: 1
                });
                chai.assert.equal(createTrailingResp.statusCode, 422, `createTrailingResp.body=${JSON.stringify(createTrailingResp.body)}`);
            });

            it("404s when looking up a value by id with leading/trailing whitespace", async () => {
                const fetchLeadingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, `/v2/values/%20${value.id}`, "GET");
                chai.assert.equal(fetchLeadingResp.statusCode, 404, `fetchLeadingResp.body=${JSON.stringify(fetchLeadingResp.body)}`);
                const fetchTrailingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, `/v2/values/${value.id}%20`, "GET");
                chai.assert.equal(fetchTrailingResp.statusCode, 404, `fetchLeadingResp.body=${JSON.stringify(fetchTrailingResp.body)}`);
            });

            describe("FK references to valueIds", () => {
                it("404s attaching valueIds with whitespace", async () => {
                    const attachLeadingResp = await testUtils.testAuthedRequest<GiftbitRestError>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {
                        valueId: `%20${value.id}`
                    });
                    chai.assert.equal(attachLeadingResp.statusCode, 404, `attachLeadingResp.body=${JSON.stringify(attachLeadingResp.body)}`);
                    chai.assert.equal(attachLeadingResp.body["messageCode"], "ValueNotFound", `attachLeadingResp.body=${JSON.stringify(attachLeadingResp.body)}`);
                    const attachTrailingResp = await testUtils.testAuthedRequest<GiftbitRestError>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {
                        valueId: `${value.id}%20`
                    });
                    chai.assert.equal(attachTrailingResp.statusCode, 404, `attachTrailingResp.body=${JSON.stringify(attachTrailingResp.body)}`);
                    chai.assert.equal(attachTrailingResp.body["messageCode"], "ValueNotFound", `attachTrailingResp.body=${JSON.stringify(attachTrailingResp.body)}`);
                });

                it("409s transacting against valueIds with whitespace", async () => {
                    const creditResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/transactions/credit", "POST", {
                        id: testUtils.generateId(),
                        currency: "USD",
                        amount: 1,
                        destination: {
                            rail: "lightrail",
                            valueId: ` ${value.id}`
                        }
                    });
                    chai.assert.equal(creditResp.statusCode, 409, `creditResp.body=${JSON.stringify(creditResp.body)}`);
                    chai.assert.equal(creditResp.body["messageCode"], "InvalidParty", `creditResp.body=${JSON.stringify(creditResp.body)}`);

                    const debitResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/transactions/debit", "POST", {
                        id: testUtils.generateId(),
                        currency: "USD",
                        amount: 1,
                        source: {
                            rail: "lightrail",
                            valueId: `${value.id}\n`
                        }
                    });
                    chai.assert.equal(debitResp.statusCode, 409, `debitResp.body=${JSON.stringify(debitResp.body)}`);
                    chai.assert.equal(debitResp.body["messageCode"], "InvalidParty", `debitResp.body=${JSON.stringify(debitResp.body)}`);

                    const checkoutResponse = await testUtils.testAuthedRequest<cassava.RestError>(router, `/v2/transactions/checkout`, "POST", {
                        id: testUtils.generateId(),
                        currency: "USD",
                        lineItems: [{unitPrice: 1}],
                        sources: [{
                            rail: "lightrail",
                            valueId: `${value.id}\n`
                        }]
                    });
                    chai.assert.equal(checkoutResponse.statusCode, 409, `checkoutResponse.body=${checkoutResponse.body}`);
                    chai.assert.equal(checkoutResponse.body["messageCode"], "InsufficientBalance", `checkoutResponse.body=${checkoutResponse.body}`);
                });

                it("does not return contacts when searching by valueId with whitespace", async () => {
                    const generic = await testUtils.createUSDValue(router, {
                        isGenericCode: true,
                        balance: null,
                        balanceRule: {
                            rule: "500",
                            explanation: "$5"
                        }
                    });
                    const attachResp = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {
                        valueId: generic.id
                    });
                    chai.assert.equal(attachResp.statusCode, 200, `attachResp.body=${JSON.stringify(attachResp.body)}`);
                    const fetchLeadingResp = await testUtils.testAuthedRequest<Contact[]>(router, `/v2/contacts?valueId=%20${generic.id}`, "GET");
                    chai.assert.equal(fetchLeadingResp.statusCode, 200, `fetchLeadingResp.body=${JSON.stringify(fetchLeadingResp.body)}`);
                    chai.assert.equal(fetchLeadingResp.body.length, 0, `fetchLeadingResp.body=${JSON.stringify(fetchLeadingResp.body)}`);
                    const fetchTrailingResp = await testUtils.testAuthedRequest<Contact[]>(router, `/v2/contacts?valueId=${generic.id}%20`, "GET");
                    chai.assert.equal(fetchTrailingResp.statusCode, 200, `fetchTrailingResp.body=${JSON.stringify(fetchTrailingResp.body)}`);
                    chai.assert.equal(fetchTrailingResp.body.length, 0, `fetchTrailingResp.body=${JSON.stringify(fetchTrailingResp.body)}`);
                });

                it("does not return transactions when searching by valueId with whitespace", async () => {
                    const txs = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?valueId=${value.id}`, "GET"); // initialBalance
                    chai.assert.equal(txs.statusCode, 200, `txs.body=${JSON.stringify(txs.body)}`);
                    chai.assert.isAtLeast(txs.body.length, 1, `txs.body=${JSON.stringify(txs.body)}`);

                    const txsLeading = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?valueId=%20${value.id}`, "GET");
                    chai.assert.equal(txsLeading.statusCode, 200, `txsLeading.body=${JSON.stringify(txsLeading.body)}`);
                    chai.assert.equal(txsLeading.body.length, 0, `txsLeading.body=${JSON.stringify(txsLeading.body)}`);

                    const txsTrailing = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?valueId=${value.id}%20`, "GET");
                    chai.assert.equal(txsTrailing.statusCode, 200, `txsTrailing.body=${JSON.stringify(txsTrailing.body)}`);
                    chai.assert.equal(txsTrailing.body.length, 0, `txsTrailing.body=${JSON.stringify(txsTrailing.body)}`);
                });
            });
        });

        describe("codes", () => {
            it("422s creating codes with leading/trailing whitespace", async () => {
                const createLeadingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/values", "POST", {
                    id: testUtils.generateId(),
                    currency: "USD",
                    balance: 1,
                    code: ` ${testUtils.generateFullcode()}`
                });
                chai.assert.equal(createLeadingResp.statusCode, 422, `createLeadingResp.body=${JSON.stringify(createLeadingResp.body)}`);
                const createTrailingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/values", "POST", {
                    id: testUtils.generateId(),
                    currency: "USD",
                    balance: 1,
                    code: `${testUtils.generateFullcode()} `
                });
                chai.assert.equal(createTrailingResp.statusCode, 422, `createTrailingResp.body=${JSON.stringify(createTrailingResp.body)}`);
            });

            it("422s updating codes to have leading/trailing whitespace", async () => {
                const updateLeadingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, `/v2/values/${value.id}/changeCode`, "POST", {
                    code: `\rLEADINGSPACE`
                });
                chai.assert.equal(updateLeadingResp.statusCode, 422, `updateLeadingResp.body=${JSON.stringify(updateLeadingResp.body)}`);

                const updateTrailingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, `/v2/values/${value.id}/changeCode`, "POST", {
                    code: `TRAILINGSPACE\t`
                });
                chai.assert.equal(updateTrailingResp.statusCode, 422, `updateTrailingResp.body=${JSON.stringify(updateTrailingResp.body)}`);
            });

            it("successfully transacts against value by code with leading/trailing whitespace", async () => {
                const debitResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", {
                    id: "debit-" + testUtils.generateId(),
                    currency: "USD",
                    amount: 1,
                    source: {
                        rail: "lightrail",
                        code: `\t${value.code}`
                    }
                });
                chai.assert.equal(debitResp.statusCode, 201, `debitResp.body=${JSON.stringify(debitResp.body)}`);

                const creditResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/credit", "POST", {
                    id: "credit-" + testUtils.generateId(),
                    currency: "USD",
                    amount: 1,
                    destination: {
                        rail: "lightrail",
                        code: `${value.code} `
                    }
                });
                chai.assert.equal(creditResp.statusCode, 201, `creditResp.body=${JSON.stringify(creditResp.body)}`);

                const checkoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
                    id: "checkout-" + testUtils.generateId(),
                    currency: "USD",
                    lineItems: [{unitPrice: 1}],
                    sources: [{
                        rail: "lightrail",
                        code: `\t${value.code} \n`
                    }]
                });
                chai.assert.equal(checkoutResp.statusCode, 201, `checkoutResp.body=${JSON.stringify(checkoutResp.body)}`);

                const otherCode = "12345";
                await testUtils.createUSDValue(router, {code: otherCode});
                const transferResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/transfer", "POST", {
                    id: "transfer-" + testUtils.generateId(),
                    currency: "USD",
                    amount: 1,
                    source: {
                        rail: "lightrail",
                        code: `\n${otherCode}`
                    },
                    destination: {
                        rail: "lightrail",
                        code: `${value.code}\r`
                    }
                });
                chai.assert.equal(transferResp.statusCode, 201, `transferResp.body=${JSON.stringify(transferResp.body)}`);
            });

            it("fetches value by code with leading/trailing whitespace", async () => {
                const fetchLeadingResp = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?code=%20${value.code}`, "GET");
                chai.assert.equal(fetchLeadingResp.statusCode, 200, `fetchLeadingResp.body=${JSON.stringify(fetchLeadingResp.body)}`);
                chai.assert.equal(fetchLeadingResp.body.length, 1, `fetchLeadingResp.body=${JSON.stringify(fetchLeadingResp.body)}`);
                chai.assert.equal(fetchLeadingResp.body[0].id, value.id, `fetchLeadingResp.body=${JSON.stringify(fetchLeadingResp.body)}`);

                const fetchTrailingResp = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?code=${value.code}%20`, "GET");
                chai.assert.equal(fetchTrailingResp.statusCode, 200, `fetchTrailingResp.body=${JSON.stringify(fetchTrailingResp.body)}`);
                chai.assert.equal(fetchTrailingResp.body.length, 1, `fetchTrailingResp.body=${JSON.stringify(fetchTrailingResp.body)}`);
                chai.assert.equal(fetchTrailingResp.body[0].id, value.id, `fetchTrailingResp.body=${JSON.stringify(fetchTrailingResp.body)}`);

                const fetchTrailingResp2 = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?code=${value.code}&nbsp`, "GET");
                chai.assert.equal(fetchTrailingResp2.statusCode, 200, `fetchTrailingResp2.body=${JSON.stringify(fetchTrailingResp2.body)}`);
                chai.assert.equal(fetchTrailingResp2.body.length, 1, `fetchTrailingResp2.body=${JSON.stringify(fetchTrailingResp2.body)}`);
                chai.assert.equal(fetchTrailingResp2.body[0].id, value.id, `fetchTrailingResp2.body=${JSON.stringify(fetchTrailingResp2.body)}`);

                const fetchWithLotsOfWhitespaceResp = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?code=%0D%0A${value.code}%20%20`, "GET");
                chai.assert.equal(fetchWithLotsOfWhitespaceResp.statusCode, 200, `fetchWithLotsOfWhitespaceResp.body=${JSON.stringify(fetchWithLotsOfWhitespaceResp.body)}`);
                chai.assert.equal(fetchWithLotsOfWhitespaceResp.body.length, 1, `fetchWithLotsOfWhitespaceResp.body=${JSON.stringify(fetchWithLotsOfWhitespaceResp.body)}`);
                chai.assert.equal(fetchWithLotsOfWhitespaceResp.body[0].id, value.id, `fetchWithLotsOfWhitespaceResp.body=${JSON.stringify(fetchWithLotsOfWhitespaceResp.body)}`);

            });
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

        it("422s creating currency codes with leading/trailing whitespace", async () => {
            const resp1 = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/currencies", "POST", currWithLeading);
            chai.assert.equal(resp1.statusCode, 422, JSON.stringify(resp1.body));

            const resp2 = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/currencies", "POST", currWithTrailing);
            chai.assert.equal(resp2.statusCode, 422, JSON.stringify(resp2.body));
        });

        it("404s fetching a currency by code with leading/trailing whitespace", async () => {
            const createCurrencyResp = await testUtils.testAuthedRequest<Currency>(router, "/v2/currencies", "POST", {
                ...currWithTrailing,
                code: "ABC"
            });
            chai.assert.equal(createCurrencyResp.statusCode, 201, `createCurrencyResp.body=${JSON.stringify(createCurrencyResp.body)}`);

            const fetchLeading = await testUtils.testAuthedRequest<cassava.RestError>(router, `/v2/currencies/%20${createCurrencyResp.body.code}`, "GET");
            chai.assert.equal(fetchLeading.statusCode, 404, `fetchLeading.body=${JSON.stringify(fetchLeading.body)}`);
            const fetchTrailing = await testUtils.testAuthedRequest<cassava.RestError>(router, `/v2/currencies/${createCurrencyResp.body.code}%20`, "GET");
            chai.assert.equal(fetchTrailing.statusCode, 404, `fetchTrailing.body=${JSON.stringify(fetchTrailing.body)}`);
        });

        describe("FK references to currency codes", () => {
            it("409s creating transactions that use currency codes with whitespace", async () => {
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
                chai.assert.equal(txLeadingResp.body["messageCode"], "WrongCurrency", `txLeadingResp.body=${JSON.stringify(txLeadingResp.body)}`);

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
                chai.assert.equal(txTrailingResp.body["messageCode"], "WrongCurrency", `txTrailingResp.body=${JSON.stringify(txTrailingResp.body)}`);
            });

            it("409s creating programs that use currency codes with whitespace", async () => {
                const programLeadingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/programs", "POST", {
                    id: testUtils.generateId(),
                    name: "Leading whitespace test",
                    currency: " USD"
                });
                chai.assert.equal(programLeadingResp.statusCode, 409, `programLeadingResp.body=${JSON.stringify(programLeadingResp.body)}`);
                chai.assert.equal(programLeadingResp.body["messageCode"], "CurrencyNotFound", `programLeadingResp.body=${JSON.stringify(programLeadingResp.body)}`);
                const programTrailingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/programs", "POST", {
                    id: testUtils.generateId(),
                    name: "Trailing whitespace test",
                    currency: "USD "
                });
                chai.assert.equal(programTrailingResp.statusCode, 409, `programTrailingResp.body=${JSON.stringify(programTrailingResp.body)}`);
                chai.assert.equal(programTrailingResp.body["messageCode"], "CurrencyNotFound", `programTrailingResp.body=${JSON.stringify(programTrailingResp.body)}`);
            });

            it("409s creating values that use currency codes with whitespace", async () => {
                const valueLeadingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/values", "POST", {
                    id: testUtils.generateId(),
                    currency: " USD",
                    balance: 50
                });
                chai.assert.equal(valueLeadingResp.statusCode, 409, `valueLeadingResp.body=${JSON.stringify(valueLeadingResp.body)}`);
                chai.assert.equal(valueLeadingResp.body["messageCode"], "CurrencyNotFound", `valueLeadingResp.body=${JSON.stringify(valueLeadingResp.body)}`);
                const valueTrailingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/values", "POST", {
                    id: testUtils.generateId(),
                    currency: "USD ",
                    balance: 50
                });
                chai.assert.equal(valueTrailingResp.statusCode, 409, `valueTrailingResp.body=${JSON.stringify(valueTrailingResp.body)}`);
                chai.assert.equal(valueTrailingResp.body["messageCode"], "CurrencyNotFound", `valueTrailingResp.body=${JSON.stringify(valueTrailingResp.body)}`);
            });

            it("does not find transactions when searching by currency code with whitespace", async () => {
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

            it("does not find programs when searching by currency code with whitespace", async () => {
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

            it("does not find values when searching by currency code with whitespace", async () => {
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
        let program;
        before(async () => {
            const programResp = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", {
                id: testUtils.generateId(),
                currency: "USD",
                name: "Irreverent test program"
            });
            chai.assert.equal(programResp.statusCode, 201, `programResp.body=${JSON.stringify(programResp.body)}`);
            program = programResp.body;
        });

        it("422s creating programIds with leading/trailing whitespace", async () => {
            const createLeadingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/programs", "POST", {
                id: `\r${testUtils.generateId()}`,
                currency: "USD",
                name: "Irrelevant test program"
            });
            chai.assert.equal(createLeadingResp.statusCode, 422, `createLeadingResp.body=${JSON.stringify(createLeadingResp.body)}`);

            const createTrailingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/values", "POST", {
                id: `${testUtils.generateId()}\v`,
                currency: "USD",
                name: "Irrelevant test program"
            });
            chai.assert.equal(createTrailingResp.statusCode, 422, `createTrailingResp.body=${JSON.stringify(createTrailingResp.body)}`);
        });

        it("404s when looking up a program by id with leading/trailing whitespace", async () => {
            const fetchLeadingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, `/v2/programs/%20${program.id}`, "GET");
            chai.assert.equal(fetchLeadingResp.statusCode, 404, `fetchLeadingResp.body=${JSON.stringify(fetchLeadingResp.body)}`);
            const fetchTrailingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, `/v2/programs/${program.id}%20`, "GET");
            chai.assert.equal(fetchTrailingResp.statusCode, 404, `fetchLeadingResp.body=${JSON.stringify(fetchTrailingResp.body)}`);
        });

        describe("FK references to programIds", () => {
            it("404s creating values from programIds with whitespace", async () => {
                const createValueResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/values", "POST", {
                    id: testUtils.generateId(),
                    programId: `\t${program.id}`,
                    balance: 1
                });
                chai.assert.equal(createValueResp.statusCode, 404, `createValueResp.body=${JSON.stringify(createValueResp.body)}`);
                chai.assert.equal(createValueResp.body["messageCode"], "ProgramNotFound", `createValueResp.body=${JSON.stringify(createValueResp.body)}`);
            });

            it("does not find values when searching by programId with whitespace", async () => {
                const createValueResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/values", "POST", {
                    id: testUtils.generateId(),
                    programId: program.id,
                    balance: 1
                });
                chai.assert.equal(createValueResp.statusCode, 201, `createValueResp.body=${JSON.stringify(createValueResp.body)}`);
                const searchValuesResp = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?programId=${program.id}%20`, "GET");
                chai.assert.equal(searchValuesResp.statusCode, 200, `searchValuesResp.body=${JSON.stringify(searchValuesResp.body)}`);
                chai.assert.equal(searchValuesResp.body.length, 0, `searchValuesResp.body=${JSON.stringify(searchValuesResp.body)}`);
            });

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
        it("422s creating transactionIds to be created with leading/trailing whitespace", async () => {
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
