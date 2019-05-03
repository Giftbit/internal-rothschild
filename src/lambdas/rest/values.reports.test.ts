import * as cassava from "cassava";
import * as testUtils from "../../utils/testUtils";
import {createUSDValue, defaultTestUser, setCodeCryptographySecrets, testAuthedRequest} from "../../utils/testUtils";
import {installRestRoutes} from "./installRestRoutes";
import {createCurrency} from "./currencies";
import {Value} from "../../model/Value";
import {Program} from "../../model/Program";
import * as chai from "chai";

describe("values reports", () => {
    const router = new cassava.Router();

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

        const program1resp = await testAuthedRequest<Program>(router, "/v2/programs", "POST", {
            id: "program1",
            currency: "USD",
            name: "program1"
        });
        chai.assert.equal(program1resp.statusCode, 201, `program1resp.body=${JSON.stringify(program1resp.body)}`);
        const program2resp = await testAuthedRequest<Program>(router, "/v2/programs", "POST", {
            id: "program2",
            currency: "USD",
            name: "program2"
        });
        chai.assert.equal(program2resp.statusCode, 201, `program2resp.body=${JSON.stringify(program2resp.body)}`);
        const program3resp = await testAuthedRequest<Program>(router, "/v2/programs", "POST", {
            id: "program3",
            currency: "USD",
            name: "program3"
        });
        chai.assert.equal(program3resp.statusCode, 201, `program1resp.body=${JSON.stringify(program3resp.body)}`);

        await createUSDValue(router, {programId: "program1"});
        await createUSDValue(router, {programId: "program2"});
        await createUSDValue(router, {programId: "program2"});
        await createUSDValue(router, {programId: "program3"});
    });

    it("can download a csv of Values", async () => {
        const resp = await testUtils.testAuthedCsvRequest<Value>(router, `/v2/values`, "GET");
        chai.assert.equal(resp.statusCode, 200, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.length, 4);

        for (const value of resp.body) {
            chai.assert.deepEqualExcluding(value, {
                id: "",
                createdDate: null,
                currency: "USD",
                balance: 50,  // `balance` is in the sql query on the card twice: ?
                usesRemaining: null,
                balanceRule: null,
                redemptionRule: null,
                programId: null,
                issuanceId: null,
                code: null,  // current version of reports query uses codeLastFour; can we just call it `code` instead?
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
                createdBy: defaultTestUser.userId,
                updatedDate: null,
                updatedContactIdDate: null,
            }, ["id", "programId", "createdDate", "updatedDate", "metadata"]); // ignoring metadata: csv formatting turns the default {} into "{}" which doesn't work with the Value interface
            chai.assert.isNotNull(value.createdDate);
            chai.assert.isNotNull(value.updatedDate);
            chai.assert.isNotNull(value.metadata);
        }
    });

    it("can download a csv of Values - filtered by programId", async () => {
        const resp1 = await testUtils.testAuthedCsvRequest<Value>(router, `/v2/values?programId=program1`, "GET");
        chai.assert.equal(resp1.statusCode, 200, `resp1.body=${JSON.stringify(resp1.body)}`);
        chai.assert.equal(resp1.body.length, 1, `resp1.body=${JSON.stringify(resp1.body)}`);
        chai.assert.deepEqualExcluding(resp1.body[0], {
            id: "",
            createdDate: null,
            currency: "USD",
            balance: 50,
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
            createdBy: defaultTestUser.userId,
            updatedDate: null,
            updatedContactIdDate: null,
        }, ["id", "createdDate", "updatedDate", "metadata"], `resp1.body=${JSON.stringify(resp1.body)}`);
        chai.assert.isNotNull(resp1.body[0].createdDate);
        chai.assert.isNotNull(resp1.body[0].updatedDate);
        chai.assert.isNotNull(resp1.body[0].metadata);

        const resp2and3 = await testUtils.testAuthedCsvRequest<Value>(router, `/v2/values?programId.in=program2,program3`, "GET");
        chai.assert.equal(resp2and3.statusCode, 200, `resp2and3.body=${JSON.stringify(resp2and3.body)}`);
        chai.assert.equal(resp2and3.body.length, 3);
        chai.assert.equal(resp2and3.body.filter(value => value.programId === "program2").length, 2, `resp2and3.body=${JSON.stringify(resp2and3.body)}`);
        chai.assert.isObject(resp2and3.body.find(value => value.programId === "program3"), `resp2and3.body=${JSON.stringify(resp2and3.body)}`);
        for (const value of resp2and3.body) {
            chai.assert.deepEqualExcluding(value, {
                id: "",
                createdDate: null,
                currency: "USD",
                balance: 50,
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
                createdBy: defaultTestUser.userId,
                updatedDate: null,
                updatedContactIdDate: null,
            }, ["id", "programId", "createdDate", "updatedDate", "metadata"], `resp2and3.body=${JSON.stringify(resp2and3.body)}`);
            chai.assert.isNotNull(value.createdDate);
            chai.assert.isNotNull(value.updatedDate);
            chai.assert.isNotNull(value.metadata);
        }
    });
});
