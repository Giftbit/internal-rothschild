import * as cassava from "cassava";
import * as testUtils from "../../utils/testUtils";
import {installRestRoutes} from "./installRestRoutes";
import {Value} from "../../model/Value";
import {Program} from "../../model/Program";
import * as chai from "chai";

describe("/v2/reports/values/", () => {
    const router = new cassava.Router();
    const genericValue: Partial<Value> = {
        id: testUtils.generateId(),
        isGenericCode: true,
        genericCodeOptions: {
            perContact: {
                balance: 50,
                usesRemaining: 3
            }
        },
        balance: null
    };
    const contactId = testUtils.generateId();

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);
        await testUtils.setCodeCryptographySecrets();
        await testUtils.createUSD(router);

        const program1resp = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", {
            id: "program1",
            currency: "USD",
            name: "program1"
        });
        chai.assert.equal(program1resp.statusCode, 201, `program1resp.body=${JSON.stringify(program1resp.body)}`);
        const program2resp = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", {
            id: "program2",
            currency: "USD",
            name: "program2"
        });
        chai.assert.equal(program2resp.statusCode, 201, `program2resp.body=${JSON.stringify(program2resp.body)}`);
        const program3resp = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", {
            id: "program3",
            currency: "USD",
            name: "program3"
        });
        chai.assert.equal(program3resp.statusCode, 201, `program1resp.body=${JSON.stringify(program3resp.body)}`);

        await testUtils.createUSDValue(router, {programId: "program1"});
        await testUtils.createUSDValue(router, {programId: "program2"});
        await testUtils.createUSDValue(router, {programId: "program2"});
        await testUtils.createUSDValue(router, {programId: "program3"});

        await testUtils.createUSDValue(router, genericValue);
        const createContactResp = await testUtils.testAuthedRequest(router, "/v2/contacts", "POST", {id: contactId});
        chai.assert.equal(createContactResp.statusCode, 201, `createContactResp.body=${JSON.stringify(createContactResp.body)}`);
        const attachGenericValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contactId}/values/attach`, "POST", {valueId: genericValue.id});
        chai.assert.equal(attachGenericValueResp.statusCode, 200, `attachGenericValueResp.body=${JSON.stringify(attachGenericValueResp.body)}`);
    });

    it("can download a csv of Values", async () => {
        const resp = await testUtils.testAuthedCsvRequest<Value>(router, `/v2/reports/values`, "GET");
        chai.assert.equal(resp.statusCode, 200, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.length, 6);

        chai.assert.isObject(resp.body.find(v => v.id === genericValue.id, `generic value not in results: ${JSON.stringify(resp.body)}`));
        chai.assert.isObject(resp.body.find(v => v.attachedFromValueId === genericValue.id, `attached value from generic not in results: ${JSON.stringify(resp.body)}`));

        const baseValueProperties: Value = {
            id: "",
            createdDate: null,
            currency: "USD",
            balance: 50,
            attachedFromValueId: null,
            genericCodeOptions: null,
            usesRemaining: null,
            balanceRule: null,
            redemptionRule: null,
            programId: null,
            issuanceId: null,
            code: null,
            isGenericCode: false,
            contactId: null,
            pretax: false,
            discount: false,
            active: true,
            canceled: false,
            frozen: false,
            discountSellerLiability: null,
            startDate: null,
            endDate: null,
            metadata: null,
            createdBy: testUtils.defaultTestUser.userId,
            updatedDate: null,
            updatedContactIdDate: null,
        };

        for (const [index, value] of resp.body.entries()) {
            if (value.id === genericValue.id) {
                chai.assert.deepEqualExcluding(value, baseValueProperties, ["id", "createdDate", "updatedDate", "balance", "metadata", "isGenericCode", "genericCodeOptions"], `generic code value: ${JSON.stringify(value)}`);
                chai.assert.isNull(value.balance, `generic code value: ${JSON.stringify(value)}`);
                chai.assert.equal(value.isGenericCode, true, `generic code value: ${JSON.stringify(value)}`);
                chai.assert.equal(value.genericCodeOptions as any, JSON.stringify(genericValue.genericCodeOptions), `generic code value: ${JSON.stringify(value)}`); // genericCodeOptions comes back stringified in this case
                chai.assert.isNotNull(value.metadata, `generic code value: ${JSON.stringify(value)}`);

            } else if (value.attachedFromValueId === genericValue.id) {
                chai.assert.deepEqualExcluding(value, baseValueProperties, ["id", "createdDate", "updatedDate", "updatedContactIdDate", "metadata", "attachedFromValueId", "usesRemaining", "contactId"], `value attached from generic: ${JSON.stringify(value)}`);
                chai.assert.equal(value.usesRemaining, 3, `attached value, from generic: ${JSON.stringify(value)}`);
                chai.assert.equal(value.contactId, contactId, `attached value, from generic: ${JSON.stringify(value)}`);
                chai.assert.isNotNull(value.metadata, `attached value, from generic: ${JSON.stringify(value)}`);

            } else {
                chai.assert.deepEqualExcluding(value, baseValueProperties, ["id", "programId", "createdDate", "updatedDate", "metadata"], `value in csv (index: )${index}) = ${JSON.stringify(value)}`);
            }

            chai.assert.isNotNull(value.createdDate, `value in csv (index: )${index}) = ${JSON.stringify(value)}`);
            chai.assert.isNotNull(value.updatedDate, `value in csv (index: )${index}) = ${JSON.stringify(value)}`);
            chai.assert.isNotNull(value.metadata, `value in csv (index: )${index}) = ${JSON.stringify(value)}`);
        }
    });

    it("can download a csv of Values - filtered by programId", async () => {
        const resp1 = await testUtils.testAuthedCsvRequest<Value>(router, `/v2/reports/values?programId=program1`, "GET");
        chai.assert.equal(resp1.statusCode, 200, `resp1.body=${JSON.stringify(resp1.body)}`);
        chai.assert.equal(resp1.body.length, 1, `resp1.body=${JSON.stringify(resp1.body)}`);
        chai.assert.deepEqualExcluding(resp1.body[0], {
            id: "",
            createdDate: null,
            currency: "USD",
            balance: 50,
            attachedFromValueId: null,
            genericCodeOptions: null,
            usesRemaining: null,
            balanceRule: null,
            redemptionRule: null,
            programId: "program1",
            issuanceId: null,
            code: null,
            isGenericCode: false,
            contactId: null,
            pretax: false,
            discount: false,
            active: true,
            canceled: false,
            frozen: false,
            discountSellerLiability: null,
            startDate: null,
            endDate: null,
            metadata: null,
            createdBy: testUtils.defaultTestUser.userId,
            updatedDate: null,
            updatedContactIdDate: null,
        }, ["id", "createdDate", "updatedDate", "metadata"], `resp1.body=${JSON.stringify(resp1.body)}`);
        chai.assert.isNotNull(resp1.body[0].createdDate);
        chai.assert.isNotNull(resp1.body[0].updatedDate);
        chai.assert.isNotNull(resp1.body[0].metadata);

        const resp2and3 = await testUtils.testAuthedCsvRequest<Value>(router, `/v2/reports/values?programId.in=program2,program3`, "GET");
        chai.assert.equal(resp2and3.statusCode, 200, `resp2and3.body=${JSON.stringify(resp2and3.body)}`);
        chai.assert.equal(resp2and3.body.length, 3);
        chai.assert.equal(resp2and3.body.filter(value => value.programId === "program2").length, 2, `resp2and3.body=${JSON.stringify(resp2and3.body)}`);
        chai.assert.isObject(resp2and3.body.find(value => value.programId === "program3"), `resp2and3.body=${JSON.stringify(resp2and3.body)}`);
        for (const [index, value] of resp2and3.body.entries()) {
            chai.assert.deepEqualExcluding(value, {
                id: "",
                createdDate: null,
                currency: "USD",
                balance: 50,
                attachedFromValueId: null,
                genericCodeOptions: null,
                usesRemaining: null,
                balanceRule: null,
                redemptionRule: null,
                programId: null,
                issuanceId: null,
                code: null,
                isGenericCode: false,
                contactId: null,
                pretax: false,
                discount: false,
                active: true,
                canceled: false,
                frozen: false,
                discountSellerLiability: null,
                startDate: null,
                endDate: null,
                metadata: null,
                createdBy: testUtils.defaultTestUser.userId,
                updatedDate: null,
                updatedContactIdDate: null,
            }, ["id", "programId", "createdDate", "updatedDate", "metadata"], `resp2and3.body=${JSON.stringify(resp2and3.body)}`);
            chai.assert.isNotNull(value.createdDate, `value in csv (index: ${index}) = ${JSON.stringify(value)}`);
            chai.assert.isNotNull(value.updatedDate, `value in csv (index: ${index}) = ${JSON.stringify(value)}`);
            chai.assert.isNotNull(value.metadata, `value in csv (index: ${index}) = ${JSON.stringify(value)}`);
        }
    });
});
