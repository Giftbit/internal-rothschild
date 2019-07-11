import * as cassava from "cassava";
import * as chai from "chai";
import * as testUtils from "../../../utils/testUtils/index";
import {defaultTestUser, generateId, setCodeCryptographySecrets} from "../../../utils/testUtils/index";
import {DbValue, Value} from "../../../model/Value";
import {Currency} from "../../../model/Currency";
import {Contact} from "../../../model/Contact";
import {getCodeLastFourNoPrefix} from "../../../model/DbCode";
import {getKnexRead, getKnexWrite} from "../../../utils/dbUtils/connection";
import {LightrailTransactionStep, Transaction} from "../../../model/Transaction";
import {installRestRoutes} from "../installRestRoutes";
import {createCurrency} from "../currencies";
import {computeCodeLookupHash, decryptCode} from "../../../utils/codeCryptoUtils";
import * as codeGenerator from "../../../utils/codeGenerator";
import * as sinon from "sinon";
import parseLinkHeader = require("parse-link-header");
import chaiExclude = require("chai-exclude");

chai.use(chaiExclude);

describe("/v2/values/", () => {

    const router = new cassava.Router();
    const sinonSandbox = sinon.createSandbox();

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);
        await setCodeCryptographySecrets();
        await createCurrency(testUtils.defaultTestUser.auth, {
            code: "USD",
            name: "The Big Bucks",
            symbol: "$",
            decimalPlaces: 2
        });
    });

    after(async () => {
        sinonSandbox.restore();
    });

    it("can list 0 values", async () => {
        const resp = await testUtils.testAuthedRequest<Value[]>(router, "/v2/values", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqual(resp.body, []);
        chai.assert.equal(resp.headers["Limit"], "100");
        chai.assert.equal(resp.headers["Max-Limit"], "1000");
    });

    it("can list 0 values in csv", async () => {
        const resp = await testUtils.testAuthedCsvRequest<Value>(router, "/v2/values", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqual(resp.body, []);
        chai.assert.equal(resp.headers["Limit"], "100");
        chai.assert.equal(resp.headers["Max-Limit"], "10000");
    });

    let value1: Partial<Value> = {
        id: "1",
        currency: "USD",
        balance: 0
    };

    it("cannot create a value with missing currency", async () => {
        const valueWithMissingCurrency: Partial<Value> = {
            id: "1",
            currency: "IDK",
            balance: 0
        };

        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/values", "POST", valueWithMissingCurrency);
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
    });

    it("cannot create a value with non-ascii characters in the ID", async () => {
        const value: Partial<Value> = {
            id: generateId() + "‎🐻",
            currency: "USD",
            balance: 0
        };

        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/values", "POST", value);
        chai.assert.equal(resp.statusCode, 422, `body=${JSON.stringify(resp.body)}`);
    });

    it("cannot update valueId", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, `/v2/values/${value1.id}`, "PATCH", {id: generateId()});
        chai.assert.equal(resp.statusCode, 422, `body=${JSON.stringify(resp.body)}`);
    });

    it("can create a value with no code, no contact, no program", async () => {
        const resp2 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value1);
        chai.assert.equal(resp2.statusCode, 201, `body=${JSON.stringify(resp2.body)}`);
        chai.assert.deepEqualExcluding(resp2.body, {
            ...value1,
            usesRemaining: null,
            programId: null,
            issuanceId: null,
            contactId: null,
            code: null,
            isGenericCode: false,
            active: true,
            canceled: false,
            frozen: false,
            pretax: false,
            startDate: null,
            endDate: null,
            redemptionRule: null,
            balanceRule: null,
            discount: false,
            discountSellerLiability: null,
            updatedContactIdDate: null,
            metadata: {},
            createdBy: defaultTestUser.auth.teamMemberId
        }, ["createdDate", "updatedDate", "createdBy"]);
        value1 = resp2.body;
    });

    it("can create a Value with a balanceRule and redemptionRule and then update rules", async () => {
        const createValueRequest: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            balanceRule: {
                rule: "500",
                explanation: "$5 the hard way 😍"
            },
            redemptionRule: {
                rule: "1 == 1",
                explanation: "always true"
            }
        };
        const createRes = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", createValueRequest);
        chai.assert.equal(createRes.statusCode, 201, `body=${JSON.stringify(createRes.body)}`);
        chai.assert.deepEqualExcluding(createRes.body, {
            ...createValueRequest,
            usesRemaining: null,
            programId: null,
            issuanceId: null,
            contactId: null,
            code: null,
            isGenericCode: false,
            balance: null,
            active: true,
            canceled: false,
            frozen: false,
            pretax: false,
            startDate: null,
            endDate: null,
            discount: false,
            discountSellerLiability: null,
            updatedContactIdDate: null,
            metadata: {},
            createdBy: defaultTestUser.auth.teamMemberId
        }, ["createdDate", "updatedDate", "createdBy"]);

        const updateValueRequest: Partial<Value> = {
            balanceRule: {
                rule: "600",
                explanation: "$6 the hard way 😍"
            },
            redemptionRule: {
                rule: "2 == 2",
                explanation: "always true"
            }
        };
        const updateRes = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${createValueRequest.id}`, "PATCH", updateValueRequest);
        chai.assert.equal(updateRes.statusCode, 200, `body=${JSON.stringify(updateRes.body)}`);
        chai.assert.deepEqualExcluding(updateRes.body, {
            ...updateValueRequest,
            id: createValueRequest.id,
            currency: createValueRequest.currency,
            usesRemaining: null,
            programId: null,
            issuanceId: null,
            contactId: null,
            code: null,
            isGenericCode: false,
            balance: null,
            active: true,
            canceled: false,
            frozen: false,
            pretax: false,
            startDate: null,
            endDate: null,
            discount: false,
            discountSellerLiability: null,
            updatedContactIdDate: null,
            metadata: {},
            createdBy: defaultTestUser.auth.teamMemberId
        }, ["createdDate", "updatedDate", "createdBy"]);
    });

    it("can get the value", async () => {
        const resp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value1.id}`, "GET");
        chai.assert.equal(resp.statusCode, 200, `body=${JSON.stringify(resp.body)}`);
        chai.assert.deepEqual(resp.body, value1);
    });

    it("409s on creating a value with a duplicate id", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/values", "POST", {
            id: value1.id,
            currency: value1.currency,
            balance: value1.balance
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "ValueIdExists");
    });

    it("cannot change a value's currency", async () => {
        const currency2: Currency = {
            code: "XYZZY",
            name: "XYZZY",
            symbol: "X",
            decimalPlaces: 0
        };

        const resp1 = await testUtils.testAuthedRequest<Value>(router, "/v2/currencies", "POST", currency2);
        chai.assert.equal(resp1.statusCode, 201, `body=${JSON.stringify(resp1.body)}`);

        const resp2 = await testUtils.testAuthedRequest<any>(router, `/v2/values/${value1.id}`, "PATCH", {currency: currency2.code});
        chai.assert.equal(resp2.statusCode, 422, `body=${JSON.stringify(resp2.body)}`);
    });

    it("can change discount", async () => {
        const resp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value1.id}`, "PATCH", {discount: true});
        chai.assert.equal(resp.statusCode, 200, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.discount, true);
        value1.discount = true;
    });

    it("can change discountSellerLiability", async () => {
        const resp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value1.id}`, "PATCH", {discountSellerLiability: 1.0});
        chai.assert.equal(resp.statusCode, 200, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.discountSellerLiability, 1.0);
        value1.discountSellerLiability = 1.0;
    });

    it("cannot change a value's balance", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, `/v2/values/${value1.id}`, "PATCH", {balance: 123123});
        chai.assert.equal(resp.statusCode, 422, `body=${JSON.stringify(resp.body)}`);
    });

    it("cannot change a value's usesRemaining", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, `/v2/values/${value1.id}`, "PATCH", {usesRemaining: 100});
        chai.assert.equal(resp.statusCode, 422, `body=${JSON.stringify(resp.body)}`);
    });

    it("can change the startDate and endDate", async () => {
        const resp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value1.id}`, "PATCH", {
            startDate: new Date("2077-01-01"),
            endDate: new Date("2277-01-01")
        });
        chai.assert.equal(resp.statusCode, 200, `body=${JSON.stringify(resp.body)}`);

        value1.startDate = new Date("2077-01-01").toISOString() as any;
        value1.endDate = new Date("2277-01-01").toISOString() as any;
        chai.assert.deepEqualExcluding(resp.body, value1, ["updatedDate"]);
    });

    it("can change the metadata", async () => {
        const resp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value1.id}`, "PATCH", {
            metadata: {
                special: "snowflake",
                emoji: "❄"
            }
        });
        chai.assert.equal(resp.statusCode, 200, `body=${JSON.stringify(resp.body)}`);

        value1.metadata = {
            special: "snowflake",
            emoji: "❄"
        };
        chai.assert.deepEqualExcluding(resp.body, value1, ["updatedDate"]);
    });

    it("can freeze a value", async () => {
        const resp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value1.id}`, "PATCH", {frozen: true});
        chai.assert.equal(resp.statusCode, 200, `body=${JSON.stringify(resp.body)}`);

        value1.frozen = true;
        chai.assert.deepEqualExcluding(resp.body, value1, ["updatedDate"]);
    });

    it("can unfreeze a value", async () => {
        const resp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value1.id}`, "PATCH", {frozen: false});
        chai.assert.equal(resp.statusCode, 200, `body=${JSON.stringify(resp.body)}`);

        value1.frozen = false;
        chai.assert.deepEqualExcluding(resp.body, value1, ["updatedDate"]);
    });

    it("can cancel a value", async () => {
        const resp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value1.id}`, "PATCH", {canceled: true});
        chai.assert.equal(resp.statusCode, 200, `body=${JSON.stringify(resp.body)}`);

        value1.canceled = true;
        chai.assert.deepEqualExcluding(resp.body, value1, ["updatedDate"]);
    });

    it("cannot uncancel a value", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, `/v2/values/${value1.id}`, "PATCH", {canceled: false});
        chai.assert.equal(resp.statusCode, 422, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "CannotUncancelValue");
    });

    it("can create a value attached to a contact", async () => {
        const contact: Partial<Contact> = {
            id: generateId(),
        };
        const contactResp = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", contact);
        chai.assert.equal(contactResp.statusCode, 201);

        const value: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            balance: 0,
            contactId: contact.id
        };
        const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(valueResp.statusCode, 201, `body=${JSON.stringify(valueResp.body)}`);
        chai.assert.equal(valueResp.body.contactId, value.contactId);
        chai.assert.equal(valueResp.body.createdDate, valueResp.body.updatedContactIdDate);
    });

    it("cannot patch contactId (must use attach)", async () => {
        const contact: Partial<Contact> = {
            id: generateId(),
        };
        const contactResp = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", contact);
        chai.assert.equal(contactResp.statusCode, 201);

        const value: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            balance: 0
        };
        const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(valueResp.statusCode, 201, `body=${JSON.stringify(valueResp.body)}`);

        const patchResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "PATCH", {
            contactId: contact.id
        });
        chai.assert.equal(patchResp.statusCode, 422, `body=${JSON.stringify(patchResp.body)}`);
    });

    it("can create a value with an initial balance, startDate and endDate", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            balance: 5000,
            startDate: new Date("2077-01-01"),
            endDate: new Date("2077-02-02")
        };

        const resp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(resp.statusCode, 201, `create body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.balance, value.balance);
        chai.assert.isNull(resp.body.updatedContactIdDate);
        chai.assert.equal((resp.body as any).startDate, value.startDate.toISOString());
        chai.assert.equal((resp.body as any).endDate, value.endDate.toISOString());
        chai.assert.isUndefined(resp.body.attachedFromValueId);
        chai.assert.isUndefined(resp.body.genericCodeOptions);

        const intitialBalanceTx = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${value.id}`, "GET");
        chai.assert.equal(intitialBalanceTx.statusCode, 200, `body=${JSON.stringify(intitialBalanceTx.body)}`);
        chai.assert.equal(intitialBalanceTx.body.transactionType, "initialBalance");
        chai.assert.equal(intitialBalanceTx.body.currency, value.currency);
        chai.assert.equal(intitialBalanceTx.body.metadata, null);
        chai.assert.lengthOf(intitialBalanceTx.body.steps, 1);
        chai.assert.equal(intitialBalanceTx.body.steps[0].rail, "lightrail");
        chai.assert.deepEqual((intitialBalanceTx.body.steps[0] as LightrailTransactionStep), {
            rail: "lightrail",
            valueId: value.id,
            code: null,
            contactId: null,
            balanceBefore: 0,
            balanceAfter: value.balance,
            balanceChange: value.balance,
            usesRemainingBefore: null,
            usesRemainingAfter: null,
            usesRemainingChange: null
        });

        // check DbTransaction created by creating Value
        const knex = await getKnexRead();
        const res = await knex("Transactions")
            .select()
            .where({
                userId: testUtils.defaultTestUser.userId,
                id: intitialBalanceTx.body.id
            });
        chai.assert.deepEqualExcluding(
            res[0], {
                "userId": "default-test-user-TEST",
                "id": value.id,
                "transactionType": "initialBalance",
                "currency": "USD",
                "lineItems": null,
                "paymentSources": null,
                "pendingVoidDate": null,
                "metadata": null,
                "tax": null,
                "createdBy": testUtils.defaultTestUser.teamMemberId,
                "nextTransactionId": null,
                "rootTransactionId": value.id,
                "totals_subtotal": null,
                "totals_tax": null,
                "totals_discountLightrail": null,
                "totals_paidLightrail": null,
                "totals_paidStripe": null,
                "totals_paidInternal": null,
                "totals_remainder": null,
                "totals_forgiven": null,
                "totals_marketplace_sellerGross": null,
                "totals_marketplace_sellerDiscount": null,
                "totals_marketplace_sellerNet": null
            }, ["createdDate", "totals"]
        );
    });

    it("can create a Value with a startDate and no endDate", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            balance: 5,
            currency: "USD",
            startDate: new Date("2030-01-01T00:00:00.000Z")
        };
        const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(createValue.statusCode, 201);
        chai.assert.equal(createValue.body.startDate as any, "2030-01-01T00:00:00.000Z");
        chai.assert.isNull(createValue.body.endDate);
    });


    it("can update a Value with a startDate and no endDate", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            balance: 5,
            currency: "USD",
        };
        const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(createValue.statusCode, 201);

        const updateValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "PATCH", {
            startDate: new Date("2030-01-01T00:00:00.000Z")
        });
        chai.assert.equal(updateValue.statusCode, 200);
        chai.assert.equal(updateValue.body.startDate as any, "2030-01-01T00:00:00.000Z");
        chai.assert.isNull(updateValue.body.endDate);
    });

    it("can't create Value with balance and balanceRule", async () => {
        let value: Partial<Value> = {
            id: generateId(),
            balance: 50,
            balanceRule: {
                rule: "500",
                explanation: "$5 the hard way"
            },
            currency: "USD"
        };
        const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(valueResp.statusCode, 422, JSON.stringify(valueResp.body));
    });

    it("can create Value with null balance and balanceRule which will default to balance of 0", async () => {
        let value: Partial<Value> = {
            id: generateId(),
            currency: "USD"
        };
        const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(valueResp.statusCode, 201, JSON.stringify(valueResp.body));
        chai.assert.equal(valueResp.body.balance, 0, JSON.stringify(valueResp.body));
    });

    it("can't create a Value with a balanceRule that does not compile", async () => {
        const postBody: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            balanceRule: {
                rule: "currentLineItem.lineTotal.subtotal * (0.1",
                explanation: "unbalanced paranthesis"
            }
        };
        const valueResp = await testUtils.testAuthedRequest<any>(router, "/v2/values", "POST", postBody);
        chai.assert.equal(valueResp.statusCode, 422, JSON.stringify(valueResp.body));
        chai.assert.equal(valueResp.body.messageCode, "BalanceRuleSyntaxError", JSON.stringify(valueResp.body));
        chai.assert.isString(valueResp.body.syntaxErrorMessage);
        chai.assert.isNumber(valueResp.body.row);
        chai.assert.isNumber(valueResp.body.column);
    });

    it("can't patch a Value to have a balanceRule that does not compile", async () => {
        const postBody: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            balanceRule: {
                rule: "currentLineItem.lineTotal.subtotal * (0.1)",
                explanation: "this is fine"
            }
        };
        const valueResp = await testUtils.testAuthedRequest<any>(router, "/v2/values", "POST", postBody);
        chai.assert.equal(valueResp.statusCode, 201, JSON.stringify(valueResp.body));

        const patchResp = await testUtils.testAuthedRequest<any>(router, `/v2/values/${postBody.id}`, "PATCH", {
            balanceRule: {
                rule: "currentLineItem.lineTotal.subtotal * (0.1",
                explanation: "unbalanced paranthesis"
            }
        });
        chai.assert.equal(patchResp.statusCode, 422, JSON.stringify(patchResp.body));
        chai.assert.equal(patchResp.body.messageCode, "BalanceRuleSyntaxError", JSON.stringify(patchResp.body));
        chai.assert.isString(patchResp.body.syntaxErrorMessage);
        chai.assert.isNumber(patchResp.body.row);
        chai.assert.isNumber(patchResp.body.column);
    });

    it("can't patch a Value to have a balanceRule when it has a balance", async () => {
        const postBody: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            balance: 500
        };
        const valueResp = await testUtils.testAuthedRequest<any>(router, "/v2/values", "POST", postBody);
        chai.assert.equal(valueResp.statusCode, 201, JSON.stringify(valueResp.body));

        const patchResp = await testUtils.testAuthedRequest<any>(router, `/v2/values/${postBody.id}`, "PATCH", {
            balanceRule: {
                rule: "currentLineItem.lineTotal.subtotal * 0.1",
                explanation: "balance rule"
            }
        });
        chai.assert.equal(patchResp.statusCode, 422, JSON.stringify(patchResp.body));
        chai.assert.notEqual(patchResp.body.messageCode, "BalanceRuleSyntaxError", JSON.stringify(patchResp.body));
    });

    it("can't create a Value with a redemptionRule that does not compile", async () => {
        const postBody: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            balanceRule: {
                rule: "currentLineItem.lineTotal.subtotal * (0.1)",
                explanation: "this is fine"
            },
            redemptionRule: {
                rule: "currentLineItem.lineTotal.subtotal > (0.1",
                explanation: "unbalanced paranthesis"
            },
        };
        const valueResp = await testUtils.testAuthedRequest<any>(router, "/v2/values", "POST", postBody);
        chai.assert.equal(valueResp.statusCode, 422, JSON.stringify(valueResp.body));
        chai.assert.equal(valueResp.body.messageCode, "RedemptionRuleSyntaxError", JSON.stringify(valueResp.body));
        chai.assert.isString(valueResp.body.syntaxErrorMessage);
        chai.assert.isNumber(valueResp.body.row);
        chai.assert.isNumber(valueResp.body.column);
    });

    it("can't patch a Value to have a redemptionRule that does not compile", async () => {
        const postBody: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            balanceRule: {
                rule: "currentLineItem.lineTotal.subtotal * (0.1)",
                explanation: "this is fine"
            },
            redemptionRule: {
                rule: "currentLineItem.lineTotal.subtotal > (0.1)",
                explanation: "this is fine"
            },
        };
        const valueResp = await testUtils.testAuthedRequest<any>(router, "/v2/values", "POST", postBody);
        chai.assert.equal(valueResp.statusCode, 201, JSON.stringify(valueResp.body));

        const patchResp = await testUtils.testAuthedRequest<any>(router, `/v2/values/${postBody.id}`, "PATCH", {
            redemptionRule: {
                rule: "currentLineItem.lineTotal.subtotal > (0.1",
                explanation: "unbalanced paranthesis"
            }
        });
        chai.assert.equal(patchResp.statusCode, 422, JSON.stringify(patchResp.body));
        chai.assert.equal(patchResp.body.messageCode, "RedemptionRuleSyntaxError", JSON.stringify(patchResp.body));
        chai.assert.isString(patchResp.body.syntaxErrorMessage);
        chai.assert.isNumber(patchResp.body.row);
        chai.assert.isNumber(patchResp.body.column);
    });

    it("can't create a Value with startDate > endDate", async () => {
        let value: Partial<Value> = {
            id: generateId(),
            balance: 50,
            currency: "USD",
            startDate: new Date("2077-01-02"),
            endDate: new Date("2077-01-01")
        };
        const valueResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/values", "POST", value);
        chai.assert.equal(valueResp.statusCode, 422, JSON.stringify(valueResp.body));
        chai.assert.equal(valueResp.body.message, "Property startDate cannot exceed endDate.");
    });

    it("can't patch a Value to have startDate > endDate", async () => {
        let value: Partial<Value> = {
            id: generateId(),
            balance: 50,
            currency: "USD",
            startDate: new Date("2077-01-01"),
            endDate: new Date("2077-01-02")
        };
        const valueResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/values", "POST", value);
        chai.assert.equal(valueResp.statusCode, 201, JSON.stringify(valueResp.body));

        const patchResp = await testUtils.testAuthedRequest<any>(router, `/v2/values/${value.id}`, "PATCH", {
            startDate: new Date("2077-01-03")
        });
        chai.assert.equal(patchResp.statusCode, 422, JSON.stringify(patchResp.body));
    });

    it("if no currency or programId is provided during value creation returns a 422", async () => {
        let value: Partial<Value> = {
            id: generateId()
        };
        const valueResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/values", "POST", value);
        chai.assert.equal(valueResp.statusCode, 422, JSON.stringify(valueResp.body));
        chai.assert.equal(valueResp.body.message, "Property currency cannot be null. Please provide a currency or a programId.");
    });

    it("can't create Value with discount = false and discountSellerLiability", async () => {
        let value: Partial<Value> = {
            id: generateId(),
            balance: 50,
            discount: false,
            discountSellerLiability: 1
        };
        const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(valueResp.statusCode, 422, JSON.stringify(valueResp.body));
    });

    it("422s on creating a value with a negative balance", async () => {
        const resp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
            id: "negativebalance",
            currency: "USD",
            balance: -5000
        });
        chai.assert.equal(resp.statusCode, 422, `create body=${JSON.stringify(resp.body)}`);
    });

    it("422s on creating a value with discountSellerLiability set and discount=false", async () => {
        const resp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
            id: "discount-origin-test",
            currency: "USD",
            discount: false,
            discountSellerLiability: 1.0
        });
        chai.assert.equal(resp.statusCode, 422, `create body=${JSON.stringify(resp.body)}`);
    });

    let value4: Partial<Value> = {
        id: "v4",
        currency: "USD",
        balance: 0,
        contactId: "idontexist"
    };

    it("409s on creating a value attached to a non-existent contact", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/values", "POST", value4);
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "ContactNotFound");
    });

    it("can't delete a value that has initialBalance Transaction", async () => {
        const value: Partial<Value> = {
            id: "vjeff",
            currency: "USD",
            balance: 0
        };

        try {
            const resp1 = await testUtils.testAuthedRequest<any>(router, "/v2/values", "POST", value);
            chai.assert.fail("an exception should be thrown during this call so this assert won't happen");
        } catch (e) {
            // pass
        }
    });

    it("404s on deleting a Value that does not exist", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, `/v2/values/idonotexist`, "DELETE");
        chai.assert.equal(resp.statusCode, 404, `delete body=${JSON.stringify(resp.body)}`);
    });

    let value5: Partial<Value> = {
        id: "vjeff2",
        currency: "USD",
        balance: 1982   // creates an initial value transaction
    };

    it("409s on deleting a Value that is in use", async () => {
        const resp1 = await testUtils.testAuthedRequest<any>(router, "/v2/values", "POST", value5);
        chai.assert.equal(resp1.statusCode, 201, `create body=${JSON.stringify(resp1.body)}`);
        value5 = resp1.body;

        const resp2 = await testUtils.testAuthedRequest<any>(router, `/v2/values/${value5.id}`, "DELETE");
        chai.assert.equal(resp2.statusCode, 409, `delete body=${JSON.stringify(resp2.body)}`);
        chai.assert.equal(resp2.body.messageCode, "ValueInUse");

        const resp3 = await testUtils.testAuthedRequest<any>(router, `/v2/values/${value5.id}`, "GET");
        chai.assert.equal(resp3.statusCode, 200, `still exists body=${JSON.stringify(resp3.body)}`);
    });

    describe("filtering and paging", () => {
        before(async () => {
            const values: Partial<DbValue>[] = [];
            const date = new Date();

            for (let i = 0; i < 1000; i++) {
                values.push({
                    userId: defaultTestUser.userId,
                    id: `paging-${i}`,
                    currency: "USD",
                    isGenericCode: false,
                    balance: Math.max((Math.sin(i) * 1000) | 0, 0),
                    pretax: true,
                    active: true,
                    canceled: !(i % 7),
                    frozen: false,
                    discount: true,
                    startDate: date,
                    endDate: date,
                    createdDate: date,
                    updatedDate: date,
                    createdBy: defaultTestUser.auth.teamMemberId
                });
            }

            const knex = await getKnexWrite();
            await knex("Values").insert(values);
        });

        it("pages and filters through many Values", async () => {
            const knex = await getKnexRead();
            const expected = await knex("Values")
                .where({
                    userId: defaultTestUser.userId,
                    canceled: false
                })
                .where("balance", ">", 200)
                .orderBy("createdDate", "desc")
                .orderBy("id", "desc");
            chai.assert.isAtLeast(expected.length, 2, "expect results");

            const page1Size = Math.ceil(expected.length / 2);
            const page1 = await testUtils.testAuthedRequest<Contact[]>(router, `/v2/values?canceled=false&balance.gt=200&limit=${page1Size}`, "GET");
            chai.assert.equal(page1.statusCode, 200, `body=${JSON.stringify(page1.body)}`);
            chai.assert.deepEqual(page1.body.map(v => v.id), expected.slice(0, page1Size).map(v => v.id), "the same ids in the same order");
            chai.assert.equal(page1.headers["Limit"], `${page1Size}`);
            chai.assert.equal(page1.headers["Max-Limit"], "1000");
            chai.assert.isDefined(page1.headers["Link"]);

            const page1Link = parseLinkHeader(page1.headers["Link"]);
            const page2 = await testUtils.testAuthedRequest<Contact[]>(router, page1Link.next.url, "GET");
            chai.assert.equal(page2.statusCode, 200, `url=${page1Link.next.url} body=${JSON.stringify(page2.body)}`);
            chai.assert.deepEqual(page2.body.map(v => v.id), expected.slice(page1Size).map(v => v.id), "the same ids in the same order");
            chai.assert.equal(page1.headers["Limit"], `${page1Size}`);
            chai.assert.equal(page1.headers["Max-Limit"], "1000");
            chai.assert.isDefined(page1.headers["Link"]);

            const page2Link = parseLinkHeader(page2.headers["Link"]);
            const page2prev = await testUtils.testAuthedRequest<Contact[]>(router, page2Link.prev.url, "GET");
            chai.assert.equal(page2prev.statusCode, 200, `url=${page2Link.prev.url} body=${JSON.stringify(page2prev.body)}`);
            chai.assert.deepEqual(page2prev.body, page1.body);
        });

        it("supports id.in", async () => {
            const ids = ["paging-1", "paging-10", "paging-11", "paging-101", "paging-100", "paging-110", "paging-111"];

            const knex = await getKnexRead();
            const expected = await knex("Values")
                .where({
                    userId: defaultTestUser.userId
                })
                .whereIn("id", ids)
                .orderBy("createdDate", "desc")
                .orderBy("id", "desc");

            const page1 = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?id.in=${ids.join(",")}`, "GET");
            chai.assert.equal(page1.statusCode, 200, `body=${JSON.stringify(page1.body)}`);
            chai.assert.deepEqualExcludingEvery<any>(page1.body, expected, ["userId", "codeHashed", "code", "codeLastFour", "startDate", "endDate", "createdDate", "updatedDate", "updatedContactIdDate", "codeEncrypted", "isGenericCode", "attachedFromValueId", "genericCodeOptions_perContact_usesRemaining", "genericCodeOptions_perContact_balance"]);
            chai.assert.isDefined(page1.headers["Link"]);
        });
    });

    it("can create a value with generic code", async () => {
        let publicCode = {
            id: generateId(),
            currency: "USD",
            code: "PUBLIC",
            isGenericCode: true,
            balance: 0
        };

        const post = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", publicCode);
        chai.assert.equal(post.statusCode, 201, `body=${JSON.stringify(post.body)}`);
        chai.assert.equal(post.body.code, publicCode.code);
        chai.assert.isTrue(post.body.isGenericCode);
        chai.assert.isNull(post.body.genericCodeOptions);

        const get = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${publicCode.id}`, "GET");
        chai.assert.equal(get.statusCode, 200, `body=${JSON.stringify(get.body)}`);
        chai.assert.equal(get.body.code, "PUBLIC");

        const showCode = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${publicCode.id}?showCode=true`, "GET");
        chai.assert.equal(showCode.statusCode, 200, `body=${JSON.stringify(showCode.body)}`);
        chai.assert.equal(showCode.body.code, "PUBLIC");

        const knex = await getKnexRead();
        const res: DbValue[] = await knex("Values")
            .select()
            .where({
                userId: testUtils.defaultTestUser.userId,
                id: publicCode.id
            });
        chai.assert.isNotNull(res[0].codeEncrypted);
        chai.assert.isNotNull(res[0].codeHashed);
        chai.assert.equal(res[0].codeHashed, await computeCodeLookupHash(publicCode.code, testUtils.defaultTestUser.auth));
        chai.assert.equal(res[0].codeLastFour, "BLIC");

        const list = await testUtils.testAuthedRequest<any>(router, `/v2/values`, "GET");
        let codeInListShowCodeFalse: Value = list.body.find(it => it.id === publicCode.id);
        chai.assert.equal(codeInListShowCodeFalse.code, "PUBLIC");
        const listShowCode = await testUtils.testAuthedRequest<any>(router, `/v2/values?showCode=true`, "GET");
        let codeInListShowCodeTrue: Value = listShowCode.body.find(it => it.id === publicCode.id);
        chai.assert.equal(codeInListShowCodeTrue.code, "PUBLIC");
    });

    it("can create a value with 1 character generic code", async () => {
        let publicCode = {
            id: generateId(),
            currency: "USD",
            code: "A",
            isGenericCode: true,
            balance: 0
        };

        const post = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", publicCode);
        chai.assert.equal(post.statusCode, 201, `body=${JSON.stringify(post.body)}`);
        chai.assert.equal(post.body.code, publicCode.code);
        chai.assert.isTrue(post.body.isGenericCode);

        const get = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${publicCode.id}`, "GET");
        chai.assert.equal(get.statusCode, 200, `body=${JSON.stringify(get.body)}`);
        chai.assert.equal(get.body.code, "A");

        const showCode = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${publicCode.id}?showCode=true`, "GET");
        chai.assert.equal(showCode.statusCode, 200, `body=${JSON.stringify(showCode.body)}`);
        chai.assert.equal(showCode.body.code, "A");

        const knex = await getKnexRead();
        const res: DbValue[] = await knex("Values")
            .select()
            .where({
                userId: testUtils.defaultTestUser.userId,
                id: publicCode.id
            });
        chai.assert.isNotNull(res[0].codeEncrypted);
        chai.assert.isNotNull(res[0].codeHashed);
        chai.assert.equal(res[0].codeHashed, await computeCodeLookupHash(publicCode.code, testUtils.defaultTestUser.auth));
        chai.assert.equal(res[0].codeLastFour, "A");

        const list = await testUtils.testAuthedRequest<any>(router, `/v2/values`, "GET");
        let codeInListShowCodeFalse: Value = list.body.find(it => it.id === publicCode.id);
        chai.assert.equal(codeInListShowCodeFalse.code, "A");
        const listShowCode = await testUtils.testAuthedRequest<any>(router, `/v2/values?showCode=true`, "GET");
        let codeInListShowCodeTrue: Value = listShowCode.body.find(it => it.id === publicCode.id);
        chai.assert.equal(codeInListShowCodeTrue.code, "A");
    });

    it("cannot create a value reusing an existing code", async () => {
        const value1Res = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
            id: generateId(),
            currency: "USD",
            code: "PANTSDANCE",
            isGenericCode: true,
            balance: 0
        });
        chai.assert.equal(value1Res.statusCode, 201, `body=${JSON.stringify(value1Res.body)}`);

        const value2Res = await testUtils.testAuthedRequest<any>(router, "/v2/values", "POST", {
            id: generateId(),
            currency: "USD",
            code: "PANTSDANCE",
            isGenericCode: true,
            balance: 0
        });
        chai.assert.equal(value2Res.statusCode, 409, `body=${JSON.stringify(value2Res.body)}`);
        chai.assert.equal(value2Res.body.messageCode, "ValueCodeExists");
    });

    it("cannot create a value with isGeneric=true and contactId set", async () => {
        const value1Res = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
            id: generateId(),
            currency: "USD",
            contactId: "abcd",
            isGenericCode: true,
            balance: 0
        });
        chai.assert.equal(value1Res.statusCode, 422, `body=${JSON.stringify(value1Res.body)}`);
    });

    it("can create a value with 🚀 emoji generic code", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            code: "🚀",
            isGenericCode: true,
            balance: 0
        };

        const post = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(post.statusCode, 201, `body=${JSON.stringify(post.body)}`);
        chai.assert.equal(post.body.code, value.code);
        chai.assert.isTrue(post.body.isGenericCode);

        const get = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
        chai.assert.equal(get.statusCode, 200, `body=${JSON.stringify(get.body)}`);
        chai.assert.equal(get.body.code, "🚀");

        const showCode = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}?showCode=true`, "GET");
        chai.assert.equal(showCode.statusCode, 200, `body=${JSON.stringify(showCode.body)}`);
        chai.assert.equal(showCode.body.code, "🚀");

        const knex = await getKnexRead();
        const res: DbValue[] = await knex("Values")
            .select()
            .where({
                userId: testUtils.defaultTestUser.userId,
                id: value.id
            });
        chai.assert.isNotNull(res[0].codeEncrypted);
        chai.assert.isNotNull(res[0].codeHashed);
        chai.assert.equal(res[0].codeHashed, await computeCodeLookupHash(value.code, testUtils.defaultTestUser.auth));

        const list = await testUtils.testAuthedRequest<any>(router, `/v2/values`, "GET");
        let codeInListShowCodeFalse: Value = list.body.find(it => it.id === value.id);
        chai.assert.equal(codeInListShowCodeFalse.code, "🚀");
        const listShowCode = await testUtils.testAuthedRequest<any>(router, `/v2/values?showCode=true`, "GET");
        let codeInListShowCodeTrue: Value = listShowCode.body.find(it => it.id === value.id);
        chai.assert.equal(codeInListShowCodeTrue.code, "🚀");
    });

    it("can create a value with unicode secure code", async () => {
        let value = {
            id: generateId(),
            currency: "USD",
            code: "芷若⳥ⳢⳫⳂⳀ",
            balance: 0
        };

        const post = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(post.statusCode, 201, `body=${JSON.stringify(post.body)}`);
        chai.assert.equal(post.body.code, "…ⳢⳫⳂⳀ");

        const get = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
        chai.assert.equal(get.statusCode, 200, `body=${JSON.stringify(get.body)}`);
        chai.assert.equal(get.body.code, "…ⳢⳫⳂⳀ");

        const showCode = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}?showCode=true`, "GET");
        chai.assert.equal(showCode.statusCode, 200, `body=${JSON.stringify(showCode.body)}`);
        chai.assert.equal(showCode.body.code, "芷若⳥ⳢⳫⳂⳀ");

        const knex = await getKnexRead();
        const res: DbValue[] = await knex("Values")
            .select()
            .where({
                userId: testUtils.defaultTestUser.userId,
                id: value.id
            });
        chai.assert.isNotNull(res[0].codeEncrypted);
        chai.assert.isNotNull(res[0].codeHashed);
        chai.assert.equal(res[0].codeHashed, await computeCodeLookupHash(value.code, testUtils.defaultTestUser.auth));

        const list = await testUtils.testAuthedRequest<any>(router, `/v2/values`, "GET");
        let codeInListShowCodeFalse: Value = list.body.find(it => it.id === value.id);
        chai.assert.equal(codeInListShowCodeFalse.code, "…ⳢⳫⳂⳀ");
        const listShowCode = await testUtils.testAuthedRequest<any>(router, `/v2/values?showCode=true`, "GET");
        let codeInListShowCodeTrue: Value = listShowCode.body.find(it => it.id === value.id);
        chai.assert.equal(codeInListShowCodeTrue.code, "芷若⳥ⳢⳫⳂⳀ");
    });

    it("can create a value with emoji secure code", async () => {
        let value = {
            id: generateId(),
            currency: "USD",
            code: "👮😭💀😒😴🙌😇🚀",
            balance: 0
        };

        const post = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(post.statusCode, 201, `body=${JSON.stringify(post.body)}`);
        chai.assert.equal(post.body.code, "…😴🙌😇🚀");

        const get = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
        chai.assert.equal(get.statusCode, 200, `body=${JSON.stringify(get.body)}`);
        chai.assert.equal(get.body.code, "…😴🙌😇🚀");

        const showCode = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}?showCode=true`, "GET");
        chai.assert.equal(showCode.statusCode, 200, `body=${JSON.stringify(showCode.body)}`);
        chai.assert.equal(showCode.body.code, "👮😭💀😒😴🙌😇🚀");

        const knex = await getKnexRead();
        const res: DbValue[] = await knex("Values")
            .select()
            .where({
                userId: testUtils.defaultTestUser.userId,
                id: value.id
            });
        chai.assert.isNotNull(res[0].codeEncrypted);
        chai.assert.isNotNull(res[0].codeHashed);
        chai.assert.equal(res[0].codeHashed, await computeCodeLookupHash(value.code, testUtils.defaultTestUser.auth));

        const list = await testUtils.testAuthedRequest<any>(router, `/v2/values`, "GET");
        let codeInListShowCodeFalse: Value = list.body.find(it => it.id === value.id);
        chai.assert.equal(codeInListShowCodeFalse.code, "…😴🙌😇🚀");
        const listShowCode = await testUtils.testAuthedRequest<any>(router, `/v2/values?showCode=true`, "GET");
        let codeInListShowCodeTrue: Value = listShowCode.body.find(it => it.id === value.id);
        chai.assert.equal(codeInListShowCodeTrue.code, "👮😭💀😒😴🙌😇🚀");
    });

    it("can create a value with secure code", async () => {
        let secureCode = {
            id: "valueWithSecureCode",
            currency: "USD",
            code: "SECURE",
            balance: 0
        };

        const respPost = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", secureCode);
        chai.assert.equal(respPost.statusCode, 201, `body=${JSON.stringify(respPost.body)}`);
        chai.assert.equal(respPost.body.code, "…CURE");
        chai.assert.isFalse(respPost.body.isGenericCode);

        const respGet = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${secureCode.id}`, "GET");
        chai.assert.equal(respGet.statusCode, 200, `body=${JSON.stringify(respGet.body)}`);
        chai.assert.equal(respGet.body.code, "…CURE");
        chai.assert.isFalse(respGet.body.isGenericCode);

        const showCode = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${secureCode.id}?showCode=true`, "GET");
        chai.assert.equal(showCode.statusCode, 200, `body=${JSON.stringify(showCode.body)}`);
        chai.assert.equal(showCode.body.code, "SECURE");

        const knex = await getKnexRead();
        const res: DbValue[] = await knex("Values")
            .select()
            .where({
                userId: testUtils.defaultTestUser.userId,
                id: secureCode.id
            });
        chai.assert.isNotNull(res[0].codeEncrypted);
        chai.assert.isNotNull(res[0].codeHashed);
        chai.assert.equal(res[0].codeHashed, await computeCodeLookupHash(secureCode.code, testUtils.defaultTestUser.auth));
        chai.assert.equal(res[0].codeLastFour, "CURE");

        const list = await testUtils.testAuthedRequest<any>(router, `/v2/values`, "GET");
        let codeInListShowCodeFalse: Value = list.body.find(it => it.id === secureCode.id);
        chai.assert.equal(codeInListShowCodeFalse.code, "…CURE");
        const listShowCode = await testUtils.testAuthedRequest<any>(router, `/v2/values?showCode=true`, "GET");
        let codeInListShowCodeTrue: Value = listShowCode.body.find(it => it.id === secureCode.id);
        chai.assert.equal(codeInListShowCodeTrue.code, "SECURE");
    });

    it("can change a code", async () => {
        let codesToTest: string[] = ["ABCDE", "ABCDEF12345", "FSSESFAWDWQCASAWD"];

        for (let code of codesToTest) {
            let value = {
                id: "changeCodeTest1" + code,
                currency: "USD",
                code: "CODEONE",
                isGenericCode: true,
                balance: 0
            };

            const create = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(create.statusCode, 201, `body=${JSON.stringify(create.body)}`);
            chai.assert.equal(create.body.code, value.code);
            chai.assert.isTrue(create.body.isGenericCode);

            const changeCodePublic = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}/changeCode`, "POST", {
                isGenericCode: true,
                code: code
            });
            chai.assert.equal(changeCodePublic.statusCode, 200, `body=${JSON.stringify(changeCodePublic.body)}`);

            const getNewPublicCode = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
            chai.assert.equal(getNewPublicCode.statusCode, 200, `body=${JSON.stringify(getNewPublicCode.body)}`);
            chai.assert.equal(getNewPublicCode.body.code, code);

            const knex = await getKnexRead();
            let res: DbValue[] = await knex("Values")
                .select()
                .where({
                    userId: testUtils.defaultTestUser.userId,
                    id: value.id
                });
            chai.assert.isNotNull(res[0].codeEncrypted);
            chai.assert.isNotNull(res[0].codeHashed);
            chai.assert.equal(res[0].codeHashed, await computeCodeLookupHash(code, testUtils.defaultTestUser.auth));
            chai.assert.equal(res[0].codeLastFour, getCodeLastFourNoPrefix(code));
            chai.assert.equal(await decryptCode(res[0].codeEncrypted), code);

            const changeCodeSecure = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}/changeCode`, "POST", {code: code});
            chai.assert.equal(changeCodeSecure.statusCode, 200, `body=${JSON.stringify(changeCodeSecure.body)}`);

            const getNewSecureCode = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
            chai.assert.equal(getNewSecureCode.statusCode, 200, `body=${JSON.stringify(getNewSecureCode.body)}`);

            res = await knex("Values")
                .select()
                .where({
                    userId: testUtils.defaultTestUser.userId,
                    id: value.id
                });
            chai.assert.isNotNull(res[0].codeEncrypted);
            chai.assert.isNotNull(res[0].codeHashed);
            chai.assert.equal(res[0].codeHashed, await computeCodeLookupHash(code, testUtils.defaultTestUser.auth));
            chai.assert.equal(res[0].codeLastFour, getCodeLastFourNoPrefix(code));
            chai.assert.equal(await decryptCode(res[0].codeEncrypted), code);
        }
    });

    it("cannot change a code to one already in use", async () => {
        const code = generateId();

        const res = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
            id: generateId(),
            currency: "USD",
            code: code
        });
        chai.assert.equal(res.statusCode, 201, `body=${JSON.stringify(res.body)}`);

        const res2 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
            id: generateId(),
            currency: "USD"
        });
        chai.assert.equal(res2.statusCode, 201, `body=${JSON.stringify(res.body)}`);

        const res3 = await testUtils.testAuthedRequest<any>(router, `/v2/values/${res2.body.id}/changeCode`, "POST", {
            code: code
        });
        chai.assert.equal(res3.statusCode, 409, `body=${JSON.stringify(res.body)}`);
        chai.assert.equal(res3.body.messageCode, "ValueCodeExists");
    });

    describe("code generation tests", () => {
        let value = {
            id: "generateCodeTest-1",
            currency: "USD",
            generateCode: {},
            balance: 0,
            metadata: {
                allyourbase: "arebelongtous"
            }
        };
        let firstGeneratedCode: string;
        let secondGeneratedCode: string;

        it("can generate a code with empty generateCode parameters", async () => {
            const create = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(create.statusCode, 201, `body=${JSON.stringify(create.body)}`);
            const lastFour = create.body.code.substring(1);
            chai.assert.equal(create.body.code, "…" + lastFour);
            chai.assert.equal(lastFour.length, 4);

            const showCode = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}?showCode=true`, "GET");
            chai.assert.equal(showCode.statusCode, 200, `body=${JSON.stringify(showCode.body)}`);
            firstGeneratedCode = showCode.body.code;
            chai.assert.equal(firstGeneratedCode.length, 16);

            const knex = await getKnexRead();
            let res: DbValue[] = await knex("Values")
                .select()
                .where({
                    userId: testUtils.defaultTestUser.userId,
                    id: value.id
                });
            chai.assert.isNotNull(res[0].codeEncrypted);
            chai.assert.isNotNull(res[0].codeHashed);
            chai.assert.equal(res[0].codeHashed, await computeCodeLookupHash(firstGeneratedCode, testUtils.defaultTestUser.auth));
            chai.assert.equal(res[0].codeLastFour, getCodeLastFourNoPrefix(firstGeneratedCode));
            chai.assert.equal(await decryptCode(res[0].codeEncrypted), firstGeneratedCode);
            chai.assert.notEqual(res[0].codeEncrypted, firstGeneratedCode);
            chai.assert.notEqual(res[0].codeHashed, firstGeneratedCode);
        });

        it("can regenerate a code", async () => {
            const changeCodeSecure = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}/changeCode`, "POST", {
                generateCode: {
                    length: 15,
                    prefix: "SPRING"
                }
            });
            chai.assert.equal(changeCodeSecure.statusCode, 200, `body=${JSON.stringify(changeCodeSecure.body)}`);

            const get = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET", value);
            const lastFour = get.body.code.substring(1);
            chai.assert.equal(get.body.code, "…" + lastFour);
            chai.assert.equal(lastFour.length, 4);

            const showCode = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}?showCode=true`, "GET");
            chai.assert.equal(showCode.statusCode, 200, `body=${JSON.stringify(showCode.body)}`);
            secondGeneratedCode = showCode.body.code;
            chai.assert.equal(secondGeneratedCode.length, 21);

            const knex = await getKnexRead();
            let res: DbValue[] = await knex("Values")
                .select()
                .where({
                    userId: testUtils.defaultTestUser.userId,
                    id: value.id
                });
            chai.assert.isNotNull(res[0].codeEncrypted);
            chai.assert.isNotNull(res[0].codeHashed);
            chai.assert.equal(res[0].codeHashed, await computeCodeLookupHash(secondGeneratedCode, testUtils.defaultTestUser.auth));
            chai.assert.equal(res[0].codeLastFour, getCodeLastFourNoPrefix(secondGeneratedCode));
            chai.assert.equal(await decryptCode(res[0].codeEncrypted), secondGeneratedCode);
            chai.assert.notEqual(res[0].codeEncrypted, secondGeneratedCode);
            chai.assert.notEqual(res[0].codeHashed, secondGeneratedCode);
            chai.assert.notEqual(firstGeneratedCode, secondGeneratedCode);
        });

        it("can download Values with decrypted codes", async () => {
            const resp = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?id.in=${value.id},decoyid&showCode=true`, "GET");
            chai.assert.equal(resp.statusCode, 200, `body=${JSON.stringify(resp.body)}`);
            chai.assert.lengthOf(resp.body, 1);
            chai.assert.equal(resp.body[0].code, secondGeneratedCode);
        });

        it("can download a csv of Values with decrypted codes", async () => {
            const resp = await testUtils.testAuthedCsvRequest<Value>(router, `/v2/values?id.in=${value.id},decoyid&showCode=true`, "GET");
            chai.assert.equal(resp.statusCode, 200, `body=${JSON.stringify(resp.body)}`);
            chai.assert.lengthOf(resp.body, 1);
            chai.assert.equal(resp.body[0].code, secondGeneratedCode);
            chai.assert.equal(resp.body[0].metadata.toString(), "{\"allyourbase\":\"arebelongtous\"}");
        });

        it("can generate a code using an emoji charset", async () => {
            let value = {
                id: generateId(),
                currency: "USD",
                generateCode: {
                    charset: "👮😭💀😒😴🙌😇🚀",
                    length: 16
                },
                balance: 0
            };

            const create = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(create.statusCode, 201, `body=${JSON.stringify(create.body)}`);
            chai.assert.lengthOf(create.body.code, 9, "length of 9 = length of 1 (for …) plus 2 for each emoji (because JS is awful)");

            const showCode = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}?showCode=true`, "GET");
            chai.assert.equal(showCode.statusCode, 200, `body=${JSON.stringify(showCode.body)}`);
            firstGeneratedCode = showCode.body.code;
            chai.assert.equal(firstGeneratedCode.length, 32, "length of 32 because 16 glyphs at 2 for each emoji (because, again, JS is awful)");

            const knex = await getKnexRead();
            let res: DbValue[] = await knex("Values")
                .select()
                .where({
                    userId: testUtils.defaultTestUser.userId,
                    id: value.id
                });
            chai.assert.isNotNull(res[0].codeEncrypted);
            chai.assert.isNotNull(res[0].codeHashed);
            chai.assert.equal(res[0].codeHashed, await computeCodeLookupHash(firstGeneratedCode, testUtils.defaultTestUser.auth));
            chai.assert.equal(res[0].codeLastFour, getCodeLastFourNoPrefix(firstGeneratedCode));
            chai.assert.equal(await decryptCode(res[0].codeEncrypted), firstGeneratedCode);
            chai.assert.notEqual(res[0].codeEncrypted, firstGeneratedCode);
            chai.assert.notEqual(res[0].codeHashed, firstGeneratedCode);
        });

        it("charset can't contain a space", async () => {
            let value = {
                id: generateId(),
                currency: "USD",
                generateCode: {
                    charset: "A BCDEFG",
                    length: 16
                },
                balance: 0
            };

            const create = await testUtils.testAuthedRequest<any>(router, "/v2/values", "POST", value);
            chai.assert.equal(create.statusCode, 422, `body=${JSON.stringify(create.body)}`);
            chai.assert.include(create.body.message, "cannot contain whitespace", `body=${JSON.stringify(create.body)}`);
        });

        it("can generate a code and get it in the response with showCode=true", async () => {
            const create = await testUtils.testAuthedRequest<Value>(router, "/v2/values?showCode=true", "POST", {
                id: "generateCodeTest-2",
                currency: "USD",
                generateCode: {
                    length: 20
                },
                balance: 0
            });
            chai.assert.equal(create.statusCode, 201, `body=${JSON.stringify(create.body)}`);
            chai.assert.lengthOf(create.body.code, 20);
        });
    });

    describe("can't create a Value with bad code properties", () => {
        it("cannot create a Value with code and generateCode", async () => {
            let valueWithPublicCode = {
                id: "value",
                currency: "USD",
                code: "SECURE",
                generateCode: {length: 6},
                balance: 0
            };

            const res = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", valueWithPublicCode);
            chai.assert.equal(res.statusCode, 422, `body=${JSON.stringify(res.body)}`);
        });

        it("cannot create a Value with isGenericCode and generateCode", async () => {
            let valueWithPublicCode = {
                id: "value",
                currency: "USD",
                isGenericCode: true,
                generateCode: {length: 6},
                balance: 0
            };

            const res = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", valueWithPublicCode);
            chai.assert.equal(res.statusCode, 422, `body=${JSON.stringify(res.body)}`);
        });

        it("cannot create a Value with code, isGenericCode, and generateCode", async () => {
            let valueWithPublicCode = {
                id: "value",
                currency: "USD",
                code: "SECURE",
                isGenericCode: true,
                generateCode: {length: 6},
                balance: 0
            };

            const res = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", valueWithPublicCode);
            chai.assert.equal(res.statusCode, 422, `body=${JSON.stringify(res.body)}`);
        });

        it("generateCode can't have unknown properties", async () => {
            let valueWithPublicCode = {
                id: "value",
                currency: "USD",
                generateCode: {length: 6, unknown: "property"},
                balance: 0
            };

            const res = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", valueWithPublicCode);
            chai.assert.equal(res.statusCode, 422, `body=${JSON.stringify(res.body)}`);
        });
    });

    describe("can't change a Value with disjoint code properties", () => {
        it("cannot create a Value with code and generateCode", async () => {
            let changeRequest = {
                code: "SECURE",
                generateCode: {length: 6},
            };

            const res = await testUtils.testAuthedRequest<Value>(router, "/v2/values/id/changeCode", "POST", changeRequest);
            chai.assert.equal(res.statusCode, 422, `body=${JSON.stringify(res.body)}`);
        });

        it("cannot create a Value with isGenericCode and generateCode", async () => {
            let changeRequest = {
                isGenericCode: true,
                generateCode: {length: 6},
            };

            const res = await testUtils.testAuthedRequest<Value>(router, "/v2/values/id/changeCode", "POST", changeRequest);
            chai.assert.equal(res.statusCode, 422, `body=${JSON.stringify(res.body)}`);
        });

        it("cannot create a Value with code, isGenericCode, and generateCode", async () => {
            let changeRequest = {
                code: "SECURE",
                isGenericCode: true,
                generateCode: {length: 6},
            };

            const res = await testUtils.testAuthedRequest<Value>(router, "/v2/values/id/changeCode", "POST", changeRequest);
            chai.assert.equal(res.statusCode, 422, `body=${JSON.stringify(res.body)}`);
        });

        it("generateCode can't have unknown properties", async () => {
            let changeRequest = {
                generateCode: {length: 6, unknown: "property"},
            };

            const res = await testUtils.testAuthedRequest<Value>(router, "/v2/values/id/changeCode", "POST", changeRequest);
            chai.assert.equal(res.statusCode, 422, `body=${JSON.stringify(res.body)}`);
        });

        it("changeCode can't have unknown properties", async () => {
            let changeRequest = {
                something: "not defined in schema",
            };

            const res = await testUtils.testAuthedRequest<Value>(router, "/v2/values/id/changeCode", "POST", changeRequest);
            chai.assert.equal(res.statusCode, 422, `body=${JSON.stringify(res.body)}`);
        });

        it("changeCode can't known and unknown properties", async () => {
            let changeRequest = {
                generateCode: {},
                something: "not defined in schema",
            };

            const res = await testUtils.testAuthedRequest<Value>(router, "/v2/values/id/changeCode", "POST", changeRequest);
            chai.assert.equal(res.statusCode, 422, `body=${JSON.stringify(res.body)}`);
        });
    });

    describe("searching values by code", () => {
        it("search by a code that doesn't exit", async () => {
            const listResponse = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?code=${generateId()}`, "GET");
            chai.assert.equal(listResponse.statusCode, 200, `body=${JSON.stringify(listResponse.body)}`);
            chai.assert.isEmpty(listResponse.body);
        });

        let importedCode = {
            id: generateId(),
            currency: "USD",
            code: "ABCDEFGHIJKLMNO",
            balance: 0
        };
        let generatedCode = {
            id: generateId(),
            currency: "USD",
            generateCode: {},
            balance: 0
        };
        let genericCode = {
            id: generateId(),
            currency: "USD",
            code: "SPRING2018",
            isGenericCode: true,
            balance: 0
        };

        it("secure imported code", async () => {
            const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", importedCode);
            chai.assert.equal(createValue.statusCode, 201, `body=${JSON.stringify(createValue.body)}`);

            const listResponse = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?code=${importedCode.code}`, "GET");
            chai.assert.equal(listResponse.statusCode, 200, `body=${JSON.stringify(listResponse.body)}`);
            chai.assert.lengthOf(listResponse.body, 1);
            chai.assert.equal(listResponse.body[0].id, importedCode.id);
            chai.assert.notInclude(listResponse.headers["Link"], "codeHashed", "Returned headers should not include codeHashed. This is an implementation detail.");
        });

        it("secure generated code", async () => {
            const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", generatedCode);
            chai.assert.equal(createValue.statusCode, 201, `body=${JSON.stringify(createValue.body)}`);

            const showCode = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${generatedCode.id}?showCode=true`, "GET");

            const listResponse = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?code=${showCode.body.code}`, "GET");
            chai.assert.equal(listResponse.statusCode, 200, `body=${JSON.stringify(listResponse.body)}`);
            chai.assert.equal(listResponse.body.length, 1);
            chai.assert.equal(listResponse.body[0].id, generatedCode.id);
        });

        it("generic code", async () => {
            const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", genericCode);
            chai.assert.equal(createValue.statusCode, 201, `body=${JSON.stringify(createValue.body)}`);

            const listResponse = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?code=${genericCode.code}`, "GET");
            chai.assert.equal(listResponse.statusCode, 200, `body=${JSON.stringify(listResponse.body)}`);
            chai.assert.equal(listResponse.body.length, 1);
            chai.assert.equal(listResponse.body[0].id, genericCode.id);
        });

        it("by code in list", async () => {
            let listResponse = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?code.in=${genericCode.code}`, "GET");
            chai.assert.equal(listResponse.statusCode, 200, `body=${JSON.stringify(listResponse.body)}`);
            chai.assert.equal(listResponse.body.length, 1);
            chai.assert.equal(listResponse.body[0].id, genericCode.id);

            listResponse = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?code.in=${genericCode.code},${importedCode.code}`, "GET");
            chai.assert.equal(listResponse.statusCode, 200, `body=${JSON.stringify(listResponse.body)}`);
            chai.assert.equal(listResponse.body.length, 2);
            const value0 = listResponse.body[0];
            const value1 = listResponse.body[1];
            chai.assert.include([genericCode.id, importedCode.id], value0.id);
            chai.assert.include([genericCode.id, importedCode.id], value1.id);
            chai.assert.notEqual(value0.id, value1.id);
        });
    });

    it(`default sorting createdDate`, async () => {
        const idAndDates = [
            {id: generateId(), createdDate: new Date("3030-02-01")},
            {id: generateId(), createdDate: new Date("3030-02-02")},
            {id: generateId(), createdDate: new Date("3030-02-03")},
            {id: generateId(), createdDate: new Date("3030-02-04")}
        ];
        for (let idAndDate of idAndDates) {
            const response = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                id: idAndDate.id,
                currency: "USD",
                balance: 1
            });
            chai.assert.equal(response.statusCode, 201);
            const knex = await getKnexWrite();
            const res: number = await knex("Values")
                .where({
                    userId: testUtils.defaultTestUser.userId,
                    id: idAndDate.id,
                })
                .update(await Value.toDbValue(testUtils.defaultTestUser.auth, {
                    ...response.body,
                    createdDate: idAndDate.createdDate,
                    updatedDate: idAndDate.createdDate
                }));
            if (res === 0) {
                chai.assert.fail(`no row updated. test is broken`);
            }
        }
        const resp = await testUtils.testAuthedRequest<Value[]>(router, "/v2/values?createdDate.gt=3030-01-01", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.equal(resp.body.length, 4);
        chai.assert.sameOrderedMembers(resp.body.map(tx => tx.id), idAndDates.reverse().map(tx => tx.id) /* reversed since createdDate desc */);
    });

    it("can create value with maximum id length", async () => {
        const value: Partial<Value> = {
            id: generateId(64),
            currency: "USD",
        };
        const createRes = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(createRes.statusCode, 201, `body=${JSON.stringify(createRes.body)}`);
        chai.assert.equal(createRes.body.id, value.id);
    });

    it("cannot create value with id exceeding max length of 64 - returns 422", async () => {
        const value: Partial<Value> = {
            id: generateId(65),
            currency: "USD"
        };
        chai.assert.equal(value.id.length, 65);

        const createValue = await testUtils.testAuthedRequest<cassava.RestError>(router, `/v2/values`, "POST", value);
        chai.assert.equal(createValue.statusCode, 422);
        chai.assert.include(createValue.body.message, "requestBody.id does not meet maximum length of 64");
    });

    it("can create a code using generateParams that will retry on collision and will return the correct re-generated code", async () => {
        const generateCodeArgs = {
            length: 6,
            charset: "abcde"
        };

        const code1 = "aaaaa";
        const code2 = "bbbbb";
        const generateCodeStub = sinonSandbox.stub(codeGenerator, "generateCode");
        generateCodeStub.withArgs(generateCodeArgs)
            .onCall(0).returns(code1)  // Value1 will be created with code1
            .onCall(1).returns(code1)  // Value2 will fail creation
            .onCall(2).returns(code1)  // Value2, retry 1 fails
            .onCall(3).returns(code2); // value2, retry 2 succeeds

        const value1Request = {
            id: generateId(),
            generateCode: generateCodeArgs,
            currency: "USD",
            balance: 1
        };
        const value2Request = {
            ...value1Request,
            id: generateId()
        };

        const createValue1 = await testUtils.testAuthedRequest<Value>(router, `/v2/values?showCode=true`, "POST", value1Request);
        chai.assert.equal(createValue1.body.code, code1);

        const createValue2 = await testUtils.testAuthedRequest<Value>(router, `/v2/values?showCode=true`, "POST", value2Request);
        chai.assert.equal(createValue2.body.code, code2);

        const getValues = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?showCode=true&id.in=${value1Request.id + "," + value2Request.id}`, "GET");
        chai.assert.sameMembers(getValues.body.map(v => v.code), [code1, code2]);
        generateCodeStub.restore();
    });

    it("can query on isGenericCode", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            balance: 10
        };
        const createValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
        chai.assert.equal(createValue.statusCode, 201);

        const genericCode: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            balance: 10,
            isGenericCode: true,
            code: "GEN_CODE_123"
        };
        const createGenericCode = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", genericCode);
        chai.assert.equal(createGenericCode.statusCode, 201);

        const listGenericCodes = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?isGenericCode=true`, "GET");
        chai.assert.deepInclude(listGenericCodes.body, createGenericCode.body);
        chai.assert.isTrue(listGenericCodes.body.map(v => v.isGenericCode).reduce((prev, next) => prev && next));

        const listUniqueValues = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?isGenericCode=false`, "GET");
        chai.assert.deepInclude(listUniqueValues.body, createValue.body);
        chai.assert.isFalse(listUniqueValues.body.map(v => v.isGenericCode).reduce((prev, next) => prev || next));
    });
});
