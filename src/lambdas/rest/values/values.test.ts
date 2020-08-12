import * as cassava from "cassava";
import * as chai from "chai";
import chaiExclude from "chai-exclude";
import * as sinon from "sinon";
import * as testUtils from "../../../utils/testUtils/index";
import {defaultTestUser, generateId, setCodeCryptographySecrets} from "../../../utils/testUtils";
import {DbValue, formatCodeForLastFourDisplay, Rule, Value} from "../../../model/Value";
import {Currency} from "../../../model/Currency";
import {Contact} from "../../../model/Contact";
import {getCodeLastFourNoPrefix} from "../../../model/DbCode";
import {getKnexRead, getKnexWrite} from "../../../utils/dbUtils/connection";
import {Transaction} from "../../../model/Transaction";
import {installRestRoutes} from "../installRestRoutes";
import {createCurrency} from "../currencies";
import {computeCodeLookupHash, decryptCode} from "../../../utils/codeCryptoUtils";
import * as codeGenerator from "../../../utils/codeGenerator";
import {generateCode} from "../../../utils/codeGenerator";
import {nowInDbPrecision} from "../../../utils/dbUtils";
import {GiftbitRestError} from "giftbit-cassava-routes";
import {LightrailTransactionStep} from "../../../model/TransactionStep";
import parseLinkHeader = require("parse-link-header");

chai.use(chaiExclude);

describe("/v2/values/", () => {

    const router = new cassava.Router();
    const sinonSandbox = sinon.createSandbox();

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);
        setCodeCryptographySecrets();
        await createCurrency(testUtils.defaultTestUser.auth, {
            code: "USD",
            name: "The Big Bucks",
            symbol: "$",
            decimalPlaces: 2,
            createdDate: nowInDbPrecision(),
            updatedDate: nowInDbPrecision(),
            createdBy: testUtils.defaultTestUser.teamMemberId
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

    it("cannot create a value with huge balance", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            balance: 999999999999
        };

        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/values", "POST", value);
        chai.assert.equal(resp.statusCode, 422, `body=${JSON.stringify(resp.body)}`);
    });

    it("cannot create a value with negative balance", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            balance: -1
        };

        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/values", "POST", value);
        chai.assert.equal(resp.statusCode, 422, `body=${JSON.stringify(resp.body)}`);
    });

    it("cannot create a value with negative usesRemaining", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            balance: 1,
            usesRemaining: -1
        };

        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/values", "POST", value);
        chai.assert.equal(resp.statusCode, 422, `body=${JSON.stringify(resp.body)}`);
    });

    it("cannot create a value with huge usesRemaining", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            balance: 1,
            usesRemaining: 999999999999
        };

        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/values", "POST", value);
        chai.assert.equal(resp.statusCode, 422, `body=${JSON.stringify(resp.body)}`);
    });

    it.only("cannot create a value with huge metadata", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            balance: 1
        };
        value.metadata = {
            bigString: "a".repeat(65536)
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
            discountSellerLiabilityRule: null,
            updatedContactIdDate: null,
            metadata: {},
            createdBy: defaultTestUser.auth.teamMemberId
        } as Value, ["createdDate", "updatedDate", "createdBy"]);
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
            discountSellerLiabilityRule: null,
            updatedContactIdDate: null,
            metadata: {},
            createdBy: defaultTestUser.auth.teamMemberId
        } as Value, ["createdDate", "updatedDate", "createdBy"]);

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
            discountSellerLiabilityRule: null,
            updatedContactIdDate: null,
            metadata: {},
            createdBy: defaultTestUser.auth.teamMemberId
        } as Value, ["createdDate", "updatedDate", "createdBy"]);
    });

    it("can get the value", async () => {
        const resp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value1.id}`, "GET");
        chai.assert.equal(resp.statusCode, 200, `body=${JSON.stringify(resp.body)}`);
        chai.assert.deepEqual(resp.body, value1);
    });

    it("treats valueId as case sensitive", async () => {
        const value1: Partial<Value> = {
            id: generateId() + "-A",
            balance: 5,
            currency: "USD"
        };
        const value2: Partial<Value> = {
            id: value1.id.toLowerCase(),
            balance: 5,
            currency: "USD"
        };
        chai.assert.notEqual(value1.id, value2.id);

        const postValue1Resp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value1);
        chai.assert.equal(postValue1Resp.statusCode, 201);

        const postValue2Resp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value2);
        chai.assert.equal(postValue2Resp.statusCode, 201, postValue2Resp.bodyRaw);

        const getValue1Resp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value1.id}`, "GET");
        chai.assert.equal(getValue1Resp.statusCode, 200);
        chai.assert.equal(getValue1Resp.body.id, value1.id);

        const getValue2Resp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value2.id}`, "GET");
        chai.assert.equal(getValue2Resp.statusCode, 200);
        chai.assert.equal(getValue2Resp.body.id, value2.id);
        chai.assert.notEqual(getValue1Resp.body.id, getValue2Resp.body.id);

        const getValues1Resp = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?id=${value1.id}`, "GET");
        chai.assert.equal(getValues1Resp.statusCode, 200);
        chai.assert.deepEqual(getValues1Resp.body, [getValue1Resp.body]);

        const getValues2Resp = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?id=${value2.id}`, "GET");
        chai.assert.equal(getValues2Resp.statusCode, 200);
        chai.assert.deepEqual(getValues2Resp.body, [getValue2Resp.body]);
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
            decimalPlaces: 0,
            createdDate: nowInDbPrecision(),
            updatedDate: nowInDbPrecision(),
            createdBy: testUtils.defaultTestUser.teamMemberId
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

    it("can uncancel a value", async () => {
        const resp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value1.id}`, "PATCH", {canceled: false});
        chai.assert.equal(resp.statusCode, 200, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.canceled, false);
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
            balanceRule: null,
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

    describe("handling unicode in IDs", () => {
        it("404s getting a Value by ID with unicode", async () => {
            const valueResp = await testUtils.testAuthedRequest<any>(router, "/v2/values/%F0%9F%92%A9", "GET");
            chai.assert.equal(valueResp.statusCode, 404);
            chai.assert.equal(valueResp.body.messageCode, "ValueNotFound");
        });

        it("returns an empty list searching Value by ID with unicode", async () => {
            const valuesResp = await testUtils.testAuthedRequest<Value[]>(router, "/v2/values?id=%F0%9F%92%A9", "GET");
            chai.assert.equal(valuesResp.statusCode, 200);
            chai.assert.deepEqual(valuesResp.body, []);
        });

        it("returns valid results, when searching ID with the in operator and some values are unicode", async () => {
            const value: Partial<Value> = {
                id: generateId(),
                balance: 5,
                currency: "USD",
            };
            const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(createValue.statusCode, 201);

            const valuesResp = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?id.in=%F0%9F%92%A9,${value.id}`, "GET");
            chai.assert.equal(valuesResp.statusCode, 200);
            chai.assert.deepEqual(valuesResp.body, [createValue.body]);
        });

        it("404s patching a Value by ID with unicode", async () => {
            const patchResp = await testUtils.testAuthedRequest<any>(router, "/v2/values/%F0%9F%92%A9", "PATCH", {pretax: true});
            chai.assert.equal(patchResp.statusCode, 404);
            chai.assert.equal(patchResp.body.messageCode, "ValueNotFound");
        });

        it("404s deleting a Value by ID with unicode", async () => {
            const deleteResp = await testUtils.testAuthedRequest<any>(router, "/v2/values/%F0%9F%92%A9", "DELETE");
            chai.assert.equal(deleteResp.statusCode, 404);
            chai.assert.equal(deleteResp.body.messageCode, "ValueNotFound");
        });
    });

    describe("discountSellerLiability", () => {
        // can be removed when discountSellerLiability is dropped from API responses
        it("can create value with discountSellerLiability set", async () => {
            const value: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                balance: 0,
                discount: true,
                discountSellerLiability: 0.25
            };
            const create = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
            chai.assert.equal(create.statusCode, 201, `body=${JSON.stringify(create.body)}`);
            chai.assert.equal(create.body.discountSellerLiability, 0.25);
            chai.assert.deepEqual(create.body.discountSellerLiabilityRule, {
                rule: "0.25",
                explanation: "Seller 25% liable"
            });
        });

        it("can create value with discountSellerLiabilityRule set - set as decimal WILL populate discountSellerLiability in response", async () => {
            const value: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                balance: 0,
                discount: true,
                discountSellerLiabilityRule: {
                    rule: "0.25",
                    explanation: "25% off"
                }
            };
            const create = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
            chai.assert.equal(create.statusCode, 201, `body=${JSON.stringify(create.body)}`);
            chai.assert.equal(create.body.discountSellerLiability, 0.25, "should be set because the rule is a number");
            chai.assert.deepEqual(create.body.discountSellerLiabilityRule, value.discountSellerLiabilityRule);
        });

        it("can create value with discountSellerLiabilityRule set - set as rule WILL NOT populate discountSellerLiability in response", async () => {
            const value: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                balance: 0,
                discount: true,
                discountSellerLiabilityRule: {
                    rule: "1 - currentLineItem.marketplaceRate",
                    explanation: "proportional to marketplace rate"
                }
            };
            const create = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
            chai.assert.equal(create.statusCode, 201, `body=${JSON.stringify(create.body)}`);
            chai.assert.isNull(create.body.discountSellerLiability, "should be null because the rule isn't a number");
            chai.assert.deepEqual(create.body.discountSellerLiabilityRule, value.discountSellerLiabilityRule);
        });

        // can be removed when discountSellerLiability is dropped from API responses
        it("can update discountSellerLiability from null", async () => {
            const value: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                balance: 0,
                discount: true
            };
            const create = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
            chai.assert.equal(create.statusCode, 201, `body=${JSON.stringify(create.body)}`);

            const update = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "PATCH", {discountSellerLiability: 1.0});
            chai.assert.equal(update.statusCode, 200, `body=${JSON.stringify(update.body)}`);
            chai.assert.equal(update.body.discountSellerLiability, 1.0);
            chai.assert.deepEqual(update.body.discountSellerLiabilityRule, {
                    rule: "1",
                    explanation: "Seller 100% liable"
                }
            );
        });

        it("can update discountSellerLiabilityRule from null", async () => {
            const value: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                balance: 0,
                discount: true
            };
            const create = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
            chai.assert.equal(create.statusCode, 201, `body=${JSON.stringify(create.body)}`);

            const discountSellerLiabilityRule: Rule = {
                rule: "0.05",
                explanation: "5%"
            };
            const valueUpdate: Partial<Value> = {
                discountSellerLiabilityRule: discountSellerLiabilityRule
            };
            const update = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "PATCH", valueUpdate);
            chai.assert.equal(update.statusCode, 200, `body=${JSON.stringify(update.body)}`);
            chai.assert.deepEqual(update.body.discountSellerLiabilityRule, {
                rule: "0.05",
                explanation: "5%"
            });
            chai.assert.equal(update.body.discountSellerLiability, 0.05, "should be set since the rule is a number");
        });

        it("can update discountSellerLiability from a number to a rule", async () => {
            const value: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                balance: 0,
                discount: true,
                discountSellerLiability: 0.25
            };
            const create = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
            chai.assert.equal(create.statusCode, 201, `body=${JSON.stringify(create.body)}`);
            chai.assert.equal(create.body.discountSellerLiability, 0.25);
            chai.assert.deepEqual(create.body.discountSellerLiabilityRule, {
                rule: "0.25",
                explanation: "Seller 25% liable"
            });

            const discountSellerLiabilityRule: Rule = {
                rule: "1 - currentLineItem.marketplaceRate",
                explanation: "proportional to marketplace rate"
            };
            const valueUpdate: Partial<Value> = {
                discountSellerLiabilityRule: discountSellerLiabilityRule
            };
            const update = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "PATCH", valueUpdate);
            chai.assert.equal(update.statusCode, 200, `body=${JSON.stringify(update.body)}`);
            chai.assert.deepEqual(update.body.discountSellerLiabilityRule, discountSellerLiabilityRule);
            chai.assert.isNull(update.body.discountSellerLiability, "should not be set since the rule isn't a number");
        });

        // can be removed when discountSellerLiability is dropped from API responses
        it("can update discountSellerLiability from a rule to a number", async () => {
            const value: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                balance: 0,
                discount: true,
                discountSellerLiabilityRule: {
                    rule: "1 - currentLineItem.marketplaceRate",
                    explanation: "proportional to marketplaceRate"
                }
            };
            const create = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
            chai.assert.equal(create.statusCode, 201, `body=${JSON.stringify(create.body)}`);
            chai.assert.isNull(create.body.discountSellerLiability);
            chai.assert.deepEqual(create.body.discountSellerLiabilityRule, value.discountSellerLiabilityRule);

            const valueUpdate: Partial<Value> = {
                discountSellerLiability: 0.50
            };
            const update = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "PATCH", valueUpdate);
            chai.assert.equal(update.statusCode, 200, `body=${JSON.stringify(update.body)}`);
            chai.assert.equal(update.body.discountSellerLiability, 0.50);
            chai.assert.deepEqual(update.body.discountSellerLiabilityRule, {
                rule: "0.5",
                explanation: "Seller 50% liable"
            });
        });

        // can be removed when discountSellerLiability is dropped from API responses
        it("can't set discountSellerLiability to be a rule", async () => {
            const value: any = {
                id: generateId(),
                currency: "USD",
                balance: 0,
                discount: true,
                discountSellerLiability: {
                    rule: "0.05",
                    explanation: "5% off"
                }
            };
            const create = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
            chai.assert.equal(create.statusCode, 422, `body=${JSON.stringify(create.body)}`);
        });

        // can be removed when discountSellerLiability is dropped from API responses
        it("can't set discountSellerLiability and discountSellerLiabilityRule at same time", async () => {
            const value: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                balance: 0,
                discount: true,
                discountSellerLiability: null,
                discountSellerLiabilityRule: {
                    rule: "0.05",
                    explanation: "5% off"
                }
            };
            const create = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
            chai.assert.equal(create.statusCode, 422, `body=${JSON.stringify(create.body)}`);
        });

        // can be removed when discountSellerLiability is dropped from API responses
        it("can't create value with discountSellerLiability if discount: false", async () => {
            const value: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                balance: 0,
                discount: false,
                discountSellerLiability: 0.25
            };
            const create = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
            chai.assert.equal(create.statusCode, 422, JSON.stringify(create.body));
        });

        it("can't create value with discountSellerLiabilityRule if discount: false", async () => {
            const value: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                balance: 0,
                discount: false,
                discountSellerLiabilityRule: {
                    rule: "0.05",
                    explanation: "5% off"
                }
            };
            const create = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
            chai.assert.equal(create.statusCode, 422, JSON.stringify(create.body));
        });

        // can be removed when discountSellerLiability is dropped from API responses
        it("can't update discount to be false if discountSellerLiability is set", async () => {
            const value: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                balance: 0,
                discount: true,
                discountSellerLiability: 0.25
            };
            const create = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
            chai.assert.equal(create.statusCode, 201, `body=${JSON.stringify(create.body)}`);
            chai.assert.equal(create.body.discountSellerLiability, 0.25);
            chai.assert.deepEqual(create.body.discountSellerLiabilityRule, {
                rule: "0.25",
                explanation: "Seller 25% liable"
            });

            const update = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "PATCH", {
                discount: false
            });
            chai.assert.equal(update.statusCode, 422, `body=${JSON.stringify(update.body)}`);
        });

        it("can't update discount to be false if discountSellerLiabilityRule is set", async () => {
            const value: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                balance: 0,
                discount: true,
                discountSellerLiabilityRule: {
                    rule: "0.25",
                    explanation: "25%"
                }
            };
            const create = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
            chai.assert.equal(create.statusCode, 201, `body=${JSON.stringify(create.body)}`);
            chai.assert.deepEqual(create.body.discountSellerLiabilityRule, {
                    rule: "0.25",
                    explanation: "25%"
                }
            );

            const update = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "PATCH", {
                discount: false
            });
            chai.assert.equal(update.statusCode, 422, `body=${JSON.stringify(update.body)}`);
        });

        it("can't set discountSellerLiabilityRule to a rule that doesn't compile", async () => {
            const value: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                balance: 0,
                discount: true,
                discountSellerLiabilityRule: {
                    rule: "currentLineItem.lineTotal.subtotal * (0.1",
                    explanation: "unclosed parenthesis"
                }
            };
            const create = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
            chai.assert.equal(create.statusCode, 422, `body=${JSON.stringify(create.body)}`);
        });

        it("can't set discountSellerLiabilityRule to a rule that evaluate to a number less than 0", async () => {
            const value: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                balance: 0,
                discount: true,
                discountSellerLiabilityRule: {
                    rule: "-1",
                    explanation: "must be between 0 and 1"
                }
            };
            const create = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
            chai.assert.equal(create.statusCode, 422, `body=${JSON.stringify(create.body)}`);
        });

        it("can't set discountSellerLiabilityRule to a rule that evaluate to a number greater than 1", async () => {
            const value: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                balance: 0,
                discount: true,
                discountSellerLiabilityRule: {
                    rule: "1.1",
                    explanation: "must be between 0 and 1"
                }
            };
            const create = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
            chai.assert.equal(create.statusCode, 422, `body=${JSON.stringify(create.body)}`);
        });

        // can be removed when discountSellerLiability is dropped from API responses
        it("can set discountSellerLiability: null, if discount: false", async () => {
            const value: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                balance: 0,
                discount: false,
                discountSellerLiability: null
            };
            const create = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
            chai.assert.equal(create.statusCode, 201, `body=${JSON.stringify(create.body)}`);
        });

        it("can set discountSellerLiabilityRule: null, if discount: false", async () => {
            const value: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                balance: 0,
                discount: false,
                discountSellerLiabilityRule: null
            };
            const create = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
            chai.assert.equal(create.statusCode, 201, `body=${JSON.stringify(create.body)}`);
        });

        it("can set both discountSellerLiabilityRule: null and discountSellerLiability: null", async () => {
            const value: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                balance: 0,
                discount: false,
                discountSellerLiability: null,
                discountSellerLiabilityRule: null
            };
            const create = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
            chai.assert.equal(create.statusCode, 201, `body=${JSON.stringify(create.body)}`);
        });
    });

    it("can't create Value with balance and balanceRule", async () => {
        const value: Partial<Value> = {
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
        const value: Partial<Value> = {
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
        const value: Partial<Value> = {
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
        const value: Partial<Value> = {
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
        const value: Partial<Value> = {
            id: generateId()
        };
        const valueResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/values", "POST", value);
        chai.assert.equal(valueResp.statusCode, 422, JSON.stringify(valueResp.body));
        chai.assert.equal(valueResp.body.message, "Property currency cannot be null. Please provide a currency or a programId.");
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

    const value4: Partial<Value> = {
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
            await testUtils.testAuthedRequest<any>(router, "/v2/values", "POST", value);
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
            chai.assert.deepEqualExcludingEvery<any>(page1.body, expected, ["userId", "codeHashed", "code", "codeLastFour", "startDate", "endDate", "createdDate", "updatedDate", "updatedContactIdDate", "codeEncrypted", "isGenericCode", "attachedFromValueId", "genericCodeOptions_perContact_usesRemaining", "genericCodeOptions_perContact_balance", "discountSellerLiabilityRule", "discountSellerLiability"]);
            chai.assert.isDefined(page1.headers["Link"]);
        });
    });

    it("can create a value with generic code", async () => {
        const publicCode = {
            id: generateId(),
            currency: "USD",
            code: "PUBLIC",
            isGenericCode: true,
            balanceRule: {
                rule: "500 + value.balanceChange",
                explanation: "$5 off"
            }
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
        chai.assert.equal(await decryptCode(res[0].codeEncrypted), "PUBLIC");
        chai.assert.equal(res[0].codeLastFour, "BLIC");

        const list = await testUtils.testAuthedRequest<any>(router, `/v2/values`, "GET");
        const codeInListShowCodeFalse: Value = list.body.find(it => it.id === publicCode.id);
        chai.assert.equal(codeInListShowCodeFalse.code, "PUBLIC");
        const listShowCode = await testUtils.testAuthedRequest<any>(router, `/v2/values?showCode=true`, "GET");
        const codeInListShowCodeTrue: Value = listShowCode.body.find(it => it.id === publicCode.id);
        chai.assert.equal(codeInListShowCodeTrue.code, "PUBLIC");
    });

    it("can create a value with 1 character generic code", async () => {
        const publicCode = {
            id: generateId(),
            currency: "USD",
            code: "A",
            isGenericCode: true,
            balanceRule: {
                rule: "500 + value.balanceChange",
                explanation: "$5 off"
            },
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
        const codeInListShowCodeFalse: Value = list.body.find(it => it.id === publicCode.id);
        chai.assert.equal(codeInListShowCodeFalse.code, "A");
        const listShowCode = await testUtils.testAuthedRequest<any>(router, `/v2/values?showCode=true`, "GET");
        const codeInListShowCodeTrue: Value = listShowCode.body.find(it => it.id === publicCode.id);
        chai.assert.equal(codeInListShowCodeTrue.code, "A");
    });

    it("cannot create a value reusing an existing code", async () => {
        const value1Res = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
            id: generateId(),
            currency: "USD",
            code: "PANTSDANCE",
            isGenericCode: true,
            balanceRule: {
                rule: "500 + value.balanceChange",
                explanation: "$5 off"
            },
        });
        chai.assert.equal(value1Res.statusCode, 201, `body=${JSON.stringify(value1Res.body)}`);

        const value2Res = await testUtils.testAuthedRequest<any>(router, "/v2/values", "POST", {
            id: generateId(),
            currency: "USD",
            code: "PANTSDANCE",
            isGenericCode: true,
            balanceRule: {
                rule: "500 + value.balanceChange",
                explanation: "$5 off"
            },
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
            balanceRule: {
                rule: "500 + value.balanceChange",
                explanation: "$5 off"
            },
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
        const codeInListShowCodeFalse: Value = list.body.find(it => it.id === value.id);
        chai.assert.equal(codeInListShowCodeFalse.code, "🚀");
        const listShowCode = await testUtils.testAuthedRequest<any>(router, `/v2/values?showCode=true`, "GET");
        const codeInListShowCodeTrue: Value = listShowCode.body.find(it => it.id === value.id);
        chai.assert.equal(codeInListShowCodeTrue.code, "🚀");
    });

    it("can create a value with unicode secure code", async () => {
        const value = {
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
        const codeInListShowCodeFalse: Value = list.body.find(it => it.id === value.id);
        chai.assert.equal(codeInListShowCodeFalse.code, "…ⳢⳫⳂⳀ");
        const listShowCode = await testUtils.testAuthedRequest<any>(router, `/v2/values?showCode=true`, "GET");
        const codeInListShowCodeTrue: Value = listShowCode.body.find(it => it.id === value.id);
        chai.assert.equal(codeInListShowCodeTrue.code, "芷若⳥ⳢⳫⳂⳀ");
    });

    it("can create a value with emoji secure code", async () => {
        const value = {
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
        const codeInListShowCodeFalse: Value = list.body.find(it => it.id === value.id);
        chai.assert.equal(codeInListShowCodeFalse.code, "…😴🙌😇🚀");
        const listShowCode = await testUtils.testAuthedRequest<any>(router, `/v2/values?showCode=true`, "GET");
        const codeInListShowCodeTrue: Value = listShowCode.body.find(it => it.id === value.id);
        chai.assert.equal(codeInListShowCodeTrue.code, "👮😭💀😒😴🙌😇🚀");
    });

    it("can create a value with secure code", async () => {
        const secureCode = {
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
        const codeInListShowCodeFalse: Value = list.body.find(it => it.id === secureCode.id);
        chai.assert.equal(codeInListShowCodeFalse.code, "…CURE");
        const listShowCode = await testUtils.testAuthedRequest<any>(router, `/v2/values?showCode=true`, "GET");
        const codeInListShowCodeTrue: Value = listShowCode.body.find(it => it.id === secureCode.id);
        chai.assert.equal(codeInListShowCodeTrue.code, "SECURE");
    });

    describe("code generation tests", () => {
        const value = {
            id: "generateCodeTest-1",
            currency: "USD",
            generateCode: {},
            balance: 0,
            metadata: {
                allyourbase: "arebelongtous"
            }
        };
        let firstGeneratedCode: string;

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
            const res: DbValue[] = await knex("Values")
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

        it("can download Values with decrypted codes", async () => {
            const resp = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?id.in=${value.id},decoyid&showCode=true`, "GET");
            chai.assert.equal(resp.statusCode, 200, `body=${JSON.stringify(resp.body)}`);
            chai.assert.lengthOf(resp.body, 1);
            chai.assert.equal(resp.body[0].code, firstGeneratedCode);
        });

        it("can download a csv of Values with decrypted codes", async () => {
            const resp = await testUtils.testAuthedCsvRequest<Value>(router, `/v2/values?id.in=${value.id},decoyid&showCode=true`, "GET");
            chai.assert.equal(resp.statusCode, 200, `body=${JSON.stringify(resp.body)}`);
            chai.assert.lengthOf(resp.body, 1);
            chai.assert.equal(resp.body[0].code, firstGeneratedCode);
            chai.assert.equal(resp.body[0].metadata.toString(), "{\"allyourbase\":\"arebelongtous\"}");
        });

        it("can generate a code using an emoji charset", async () => {
            const value = {
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
            const res: DbValue[] = await knex("Values")
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
            const value = {
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
            const valueWithPublicCode = {
                id: "value",
                currency: "USD",
                code: "SECURE",
                generateCode: {length: 6},
                balance: 0
            };

            const res = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", valueWithPublicCode);
            chai.assert.equal(res.statusCode, 422, `body=${JSON.stringify(res.body)}`);
        });

        it("cannot create a Value with code, isGenericCode, and generateCode", async () => {
            const valueWithPublicCode = {
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
            const valueWithPublicCode = {
                id: "value",
                currency: "USD",
                generateCode: {length: 6, unknown: "property"},
                balance: 0
            };

            const res = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", valueWithPublicCode);
            chai.assert.equal(res.statusCode, 422, `body=${JSON.stringify(res.body)}`);
        });
    });

    describe("searching values by code", () => {
        it("search by a code that doesn't exit", async () => {
            const listResponse = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?code=${generateId()}`, "GET");
            chai.assert.equal(listResponse.statusCode, 200, `body=${JSON.stringify(listResponse.body)}`);
            chai.assert.isEmpty(listResponse.body);
        });

        const importedCode = {
            id: generateId(),
            currency: "USD",
            code: "ABCDEFGHIJKLMNO",
            balance: 0
        };
        const generatedCode = {
            id: generateId(),
            currency: "USD",
            generateCode: {},
            balance: 0
        };
        const genericCode = {
            id: generateId(),
            currency: "USD",
            code: "SPRING2018",
            isGenericCode: true,
            balanceRule: {
                rule: "0 + value.balanceChange",
                explanation: "$0 off"
            },
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
        for (const idAndDate of idAndDates) {
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
            balanceRule: {
                rule: "10 + value.balanceChange",
                explanation: "$0.10 off"
            },
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

    describe("/changeCode", () => {
        describe("unique value", () => {
            const value: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                code: generateCode({}),
                balance: 100
            };

            before(async function () {
                const create = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
                chai.assert.equal(create.statusCode, 201, `resp: ${JSON.stringify(create.body)}`);
            });

            it("can change unique code to specified code. returns code last 4", async () => {
                const code = "NEWCODEXYZ123";
                const changeCode = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}/changeCode`, "POST", {
                    code: code
                });
                chai.assert.equal(changeCode.statusCode, 200, `resp: ${changeCode.body}`);
                chai.assert.deepInclude(changeCode.body, {
                    ...value,
                    isGenericCode: false,
                    code: formatCodeForLastFourDisplay(code)
                });
                await assertCodeIsStoredCorrectlyInDB(value.id, code);
            });

            it("can change unique code to generated code. including showCode=true in changeCode request will return full code", async () => {
                const changeCode = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}/changeCode?showCode=true`, "POST", {
                    generateCode: {length: 15}
                });
                chai.assert.equal(changeCode.statusCode, 200, `resp: ${changeCode.body}`);
                const code = changeCode.body.code;
                chai.assert.lengthOf(code, 15);
                chai.assert.deepInclude(changeCode.body, {
                    ...value,
                    isGenericCode: false,
                    code: code
                });
                await assertCodeIsStoredCorrectlyInDB(value.id, code);
            });

            it("can change a code to null", async () => {
                const changeCode = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}/changeCode?showCode=true`, "POST", {
                    code: null
                });
                chai.assert.equal(changeCode.statusCode, 200, `resp: ${changeCode.body}`);
                chai.assert.isNull(changeCode.body.code);

                const knex = await getKnexRead();
                const res: DbValue[] = await knex("Values")
                    .select()
                    .where({
                        userId: testUtils.defaultTestUser.userId,
                        id: value.id
                    });
                chai.assert.isNull(res[0].codeEncrypted);
                chai.assert.isNull(res[0].codeHashed);
                chai.assert.isNull(res[0].codeLastFour);
            });
        });

        describe("generic value", () => {
            const value: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                code: "EASYMONEY99",
                balance: 1000,
                isGenericCode: true,
                genericCodeOptions: {
                    perContact: {
                        balance: 100,
                        usesRemaining: null
                    }
                }
            };

            before(async function () {
                const create = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
                chai.assert.equal(create.statusCode, 201, `resp: ${JSON.stringify(create)}`);
            });

            it("can change generic code to specified code. returns full code", async () => {
                const code = "NEWGENCODE123";
                const changeCode = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}/changeCode`, "POST", {
                    code: code
                });
                chai.assert.equal(changeCode.statusCode, 200, `resp: ${changeCode.body}`);
                chai.assert.deepInclude(changeCode.body, {
                    ...value,
                    code: code // returns full code for generic code
                });
                await assertCodeIsStoredCorrectlyInDB(value.id, code);
            });

            it("can change generic code to generated code. returns full code", async () => {
                const changeCode = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}/changeCode`, "POST", {
                    generateCode: {length: 15}
                });
                chai.assert.equal(changeCode.statusCode, 200, `resp: ${changeCode.body}`);
                const code = changeCode.body.code;
                chai.assert.lengthOf(code, 15);
                chai.assert.deepInclude(changeCode.body, {
                    ...value,
                    code: code // returns full code for generic code
                });
                await assertCodeIsStoredCorrectlyInDB(value.id, code);
            });
        });

        it("can use changeCode to set a code on a Value that was created without a code", async () => {
            const value: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                balance: 100
            };

            const create = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(create.statusCode, 201, `resp: ${JSON.stringify(create.body)}`);
            chai.assert.isNull(create.body.code);

            const code = generateCode({});
            const changeCode = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}/changeCode`, "POST", {
                code: code
            });
            chai.assert.equal(changeCode.statusCode, 200, `resp: ${changeCode.body}`);
            chai.assert.deepInclude(changeCode.body, {
                ...value,
                code: formatCodeForLastFourDisplay(code)
            });
            await assertCodeIsStoredCorrectlyInDB(value.id, code);
        });

        describe("edge cases and error handling", () => {
            const value: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                code: generateCode({}),
                balance: 100
            };

            before(async function () {
                const create = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
                chai.assert.equal(create.statusCode, 201, `resp: ${JSON.stringify(create.body)}`);
            });

            it("can change a code to itself", async () => {
                const changeCode = await testUtils.testAuthedRequest<cassava.RestError>(router, `/v2/values/${value.id}/changeCode`, "POST", {
                    code: value.code // use same code as what it was created with
                });
                chai.assert.equal(changeCode.statusCode, 200, `body=${JSON.stringify(changeCode.body)}`);
                chai.assert.deepInclude(changeCode.body, {});
            });

            it("cannot change a code to one already in use", async () => {
                const newValue = {...value, id: generateId(), code: generateCode({})};
                const createNewValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", newValue);
                chai.assert.equal(createNewValue.statusCode, 201, `resp: ${JSON.stringify(createNewValue.body)}`);

                const changeCode = await testUtils.testAuthedRequest<cassava.RestError>(router, `/v2/values/${newValue.id}/changeCode`, "POST", {
                    code: value.code // use same code as one that already exists
                });
                chai.assert.equal(changeCode.statusCode, 409, `body=${JSON.stringify(changeCode.body)}`);
                chai.assert.equal(changeCode.body["messageCode"], "ValueCodeExists");
            });

            it("cannot supply both code and generateCode", async () => {
                const changeRequest = {
                    code: "SECURE",
                    generateCode: {length: 6},
                };

                const res = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}/changeCode`, "POST", changeRequest);
                chai.assert.equal(res.statusCode, 422, `body=${JSON.stringify(res.body)}`);
            });

            it("cannot supply isGenericCode: true", async () => {
                const changeRequest = {
                    isGenericCode: true
                };

                const res = await testUtils.testAuthedRequest<Value>(router, "/v2/values/id/changeCode", "POST", changeRequest);
                chai.assert.equal(res.statusCode, 422, `body=${JSON.stringify(res.body)}`);
            });

            it("cannot supply isGenericCode: false", async () => {
                const changeRequest = {
                    isGenericCode: false
                };

                const res = await testUtils.testAuthedRequest<Value>(router, "/v2/values/id/changeCode", "POST", changeRequest);
                chai.assert.equal(res.statusCode, 422, `body=${JSON.stringify(res.body)}`);
            });

            it("can't have unknown properties in request", async () => {
                const changeRequest = {
                    something: "not defined in schema",
                };

                const res = await testUtils.testAuthedRequest<Value>(router, "/v2/values/id/changeCode", "POST", changeRequest);
                chai.assert.equal(res.statusCode, 422, `body=${JSON.stringify(res.body)}`);
            });

            it("can't have unknown properties in request's nested properties", async () => {
                const changeRequest = {
                    generateCode: {length: 6, unknown: "property"},
                };

                const res = await testUtils.testAuthedRequest<Value>(router, "/v2/values/id/changeCode", "POST", changeRequest);
                chai.assert.equal(res.statusCode, 422, `body=${JSON.stringify(res.body)}`);
            });
        });
    });

    describe("whitespace handling", () => {
        let value: Value;
        let contact: Contact;

        before(async function () {
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
                it("404s attaching valueIds with leading/trailing whitespace", async () => {
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

                it("409s transacting against valueIds with leading/trailing whitespace", async () => {
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

                it("does not return contacts when searching by valueId with leading/trailing whitespace", async () => {
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

                it("does not return transactions when searching by valueId with leading/trailing whitespace", async () => {
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
});

async function assertCodeIsStoredCorrectlyInDB(valueId: string, code: string): Promise<void> {
    const knex = await getKnexRead();
    const res: DbValue[] = await knex("Values")
        .select()
        .where({
            userId: testUtils.defaultTestUser.userId,
            id: valueId
        });
    chai.assert.isNotNull(res[0].codeEncrypted);
    chai.assert.isNotNull(res[0].codeHashed);
    chai.assert.equal(res[0].codeHashed, await computeCodeLookupHash(code, testUtils.defaultTestUser.auth));
    chai.assert.equal(res[0].codeLastFour, getCodeLastFourNoPrefix(code));
    chai.assert.equal(await decryptCode(res[0].codeEncrypted), code);
    chai.assert.notEqual(res[0].codeEncrypted, code);
    chai.assert.notEqual(res[0].codeHashed, code);
}
