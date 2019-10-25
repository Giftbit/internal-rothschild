import * as cassava from "cassava";
import * as testUtils from "../../utils/testUtils";
import {installRestRoutes} from "./installRestRoutes";
import {Value} from "../../model/Value";
import {Program} from "../../model/Program";
import * as chai from "chai";
import sinon from "sinon";
import * as Reports from "./reports";
import {ReportValue} from "./values/ReportValue";
import parseLinkHeader = require("parse-link-header");


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

    const program1Id = "program1";
    let valueFromProgram1: Value;

    function getValueReportHeadersForAssertions(limit: number = 10000) {
        return {
            "Limit": limit.toString(),
            "Max-Limit": "10000",
            "Content-Type": "text/csv"
        };
    }

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);
        await testUtils.setCodeCryptographySecrets();
        await testUtils.createUSD(router);

        const program1resp = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", {
            id: program1Id,
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

        valueFromProgram1 = await testUtils.createUSDValue(router, {programId: "program1"});
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
        const resp = await testUtils.testAuthedCsvRequest<ReportValue>(router, `/v2/reports/values`, "GET");
        chai.assert.equal(resp.statusCode, 200, `body=${JSON.stringify(resp.body)}`);
        chai.assert.deepInclude(resp.headers as any, getValueReportHeadersForAssertions(), `resp.headers=${JSON.stringify(resp.headers)}`);
        chai.assert.equal(resp.body.length, 6);

        chai.assert.isObject(resp.body.find(v => v.id === genericValue.id, `generic value not in results: ${JSON.stringify(resp.body)}`));
        chai.assert.isObject(resp.body.find(v => v.attachedFromValueId === genericValue.id, `attached value from generic not in results: ${JSON.stringify(resp.body)}`));

        const baseValueProperties: ReportValue = {
            id: "",
            createdDate: null,
            currency: "USD",
            balance: 50,
            attachedFromValueId: null,
            genericCodeOptions_perContact_balance: null,
            genericCodeOptions_perContact_usesRemaining: null,
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
            discountSellerLiabilityRule: null,
            startDate: null,
            endDate: null,
            metadata: null,
            createdBy: testUtils.defaultTestUser.userId,
            updatedDate: null,
            updatedContactIdDate: null,
        };

        for (const [index, value] of resp.body.entries()) {
            if (value.id === genericValue.id) {
                chai.assert.deepEqualExcluding(value, baseValueProperties, ["id", "createdDate", "updatedDate", "balance", "metadata", "isGenericCode", "genericCodeOptions_perContact_balance", "genericCodeOptions_perContact_usesRemaining"], `generic code value: ${JSON.stringify(value)}`);
                chai.assert.isNull(value.balance, `generic code value: ${JSON.stringify(value)}`);
                chai.assert.equal(value.isGenericCode, true, `generic code value: ${JSON.stringify(value)}`);
                chai.assert.equal(value.genericCodeOptions_perContact_balance as any, genericValue.genericCodeOptions.perContact.balance, `generic code value: ${JSON.stringify(value)}`); // genericCodeOptions comes back stringified in this case
                chai.assert.equal(value.genericCodeOptions_perContact_usesRemaining as any, genericValue.genericCodeOptions.perContact.usesRemaining, `generic code value: ${JSON.stringify(value)}`); // genericCodeOptions comes back stringified in this case
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

    it("can page through csv of Values", async () => {
        const getAllValues = await testUtils.testAuthedCsvRequest<ReportValue>(router, `/v2/reports/values`, "GET");
        chai.assert.equal(getAllValues.statusCode, 200);
        chai.assert.isAbove(getAllValues.body.length, 3);

        let returnedValueIds = [];
        let resp = await testUtils.testAuthedCsvRequest<ReportValue>(router, `/v2/reports/values?limit=3&suppressLimitError=true`, "GET");
        chai.assert.equal(resp.statusCode, 200);
        returnedValueIds.push(...resp.body.map(v => v.id));
        let linkHeaders = parseLinkHeader(resp.headers["Link"]);
        let nextLink = linkHeaders.next.url;
        while (nextLink) {
            resp = await testUtils.testAuthedCsvRequest<ReportValue>(router, nextLink, "GET");
            chai.assert.equal(resp.statusCode, 200);
            returnedValueIds.push(...resp.body.map(v => v.id));
            let linkHeaders = parseLinkHeader(resp.headers["Link"]);
            nextLink = (linkHeaders && linkHeaders.next) ? linkHeaders.next.url : null;
        }

        const expected = getAllValues.body.map(v => v.id);
        chai.assert.sameDeepMembers(returnedValueIds, expected);
    });

    it("can download a csv of Values - filtered by programId", async () => {
        const resp1 = await testUtils.testAuthedCsvRequest<ReportValue>(router, `/v2/reports/values?programId=program1`, "GET");
        chai.assert.equal(resp1.statusCode, 200, `resp1.body=${JSON.stringify(resp1.body)}`);
        chai.assert.deepInclude(resp1.headers as any, getValueReportHeadersForAssertions(), `resp.headers=${JSON.stringify(resp1.headers)}`);
        chai.assert.equal(resp1.body.length, 1, `resp1.body=${JSON.stringify(resp1.body)}`);
        chai.assert.deepEqualExcluding(resp1.body[0], {
            id: "",
            createdDate: null,
            currency: "USD",
            balance: 50,
            attachedFromValueId: null,
            genericCodeOptions_perContact_balance: null,
            genericCodeOptions_perContact_usesRemaining: null,
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
            discountSellerLiabilityRule: null,
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

        const resp2and3 = await testUtils.testAuthedCsvRequest<ReportValue>(router, `/v2/reports/values?programId.in=program2,program3`, "GET");
        chai.assert.equal(resp2and3.statusCode, 200, `resp2and3.body=${JSON.stringify(resp2and3.body)}`);
        chai.assert.deepInclude(resp2and3.headers as any, getValueReportHeadersForAssertions(), `resp.headers=${JSON.stringify(resp2and3.headers)}`);
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
                genericCodeOptions_perContact_balance: null,
                genericCodeOptions_perContact_usesRemaining: null,
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
                discountSellerLiabilityRule: null,
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

    it("can format currencies", async () => {
        const genericCode: Partial<Value> = {
            id: testUtils.generateId(),
            currency: "USD",
            isGenericCode: true,
            genericCodeOptions: {
                perContact: {
                    balance: 50,
                    usesRemaining: 3
                }
            },
            balance: 150
        };
        const createGenericCode = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", genericCode);
        chai.assert.equal(createGenericCode.statusCode, 201);

        const uniqueCode: Partial<Value> = {
            id: testUtils.generateId(),
            currency: "USD",
            balance: 250
        };
        const createUniqueCode = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", uniqueCode);
        chai.assert.equal(createUniqueCode.statusCode, 201);

        const csv = await testUtils.testAuthedCsvRequest<ReportValue>(router, `/v2/reports/values?id.in=${uniqueCode.id + "," + genericCode.id}&formatCurrencies=true`, "GET");
        const respGenericCode = csv.body.find(v => v.isGenericCode === true);
        chai.assert.deepInclude(respGenericCode, {
            balance: "$1.50",
            genericCodeOptions_perContact_balance: "$0.50"
        });

        const respUniqueCode = csv.body.find(v => v.isGenericCode === false);
        chai.assert.deepInclude(respUniqueCode, {
            balance: "$2.50",
            genericCodeOptions_perContact_balance: null
        });
    });

    describe("row limiting", () => {
        const sinonSandbox = sinon.createSandbox();
        let valueCount: number;
        let mockResults10000: ReportValue[];
        let mockResults1: ReportValue[];
        let mockResults0: ReportValue[];

        before(async function () {
            const valueRes = await testUtils.testAuthedRequest<Value[]>(router, "/v2/values", "GET");
            chai.assert.equal(valueRes.statusCode, 200, `valueRes.body=${JSON.stringify(valueRes.body)}`);
            chai.assert.isTrue(valueRes.body.length >= 2); // need at least two so we can request one less than the actual count in tests below
            valueCount = valueRes.body.length;

            const mockValue = {
                id: "mock",
                currency: "USD",
                balance: 50,
                usesRemaining: 3,
                programId: null,
                issuanceId: null,
                contactId: "mock",
                code: null,
                isGenericCode: false,
                attachedFromValueId: "mock",
                pretax: false,
                active: true,
                canceled: false,
                frozen: false,
                discount: false,
                discountSellerLiability: null,
                redemptionRule: null,
                balanceRule: null,
                startDate: null,
                endDate: null,
                metadata: "",
                createdDate: "2019-07-10T18:56:13.000Z",
                updatedDate: "2019-07-10T18:56:13.000Z",
                updatedContactIdDate: "2019-07-10T18:56:13.000Z",
                createdBy: "default-test-user-TEST"
            };

            mockResults10000 = Array(10000).fill(mockValue);
            mockResults1 = Array(1).fill(mockValue);
            mockResults0 = [];
        });

        afterEach(() => {
            sinonSandbox.restore();
        });

        describe("default behaviour: error if more results than limit/default limit", () => {
            it("returns success if results count <= limit", async () => {
                const resp = await testUtils.testAuthedCsvRequest(router, `/v2/reports/values?limit=${valueCount}`, "GET");
                chai.assert.equal(resp.statusCode, 200, `resp.body=${JSON.stringify(resp.body)}`);
                chai.assert.deepInclude(resp.headers as any, getValueReportHeadersForAssertions(valueCount), `resp.headers=${JSON.stringify(resp.headers)}`);
                chai.assert.equal(resp.body.length, valueCount, `resp.body=${JSON.stringify(resp.body)}`);
            });

            it("returns error if results count > limit", async () => {
                const resp = await testUtils.testAuthedRequest(router, `/v2/reports/values?limit=${valueCount - 1}`, "GET");
                chai.assert.equal(resp.statusCode, 422, `resp.body=${JSON.stringify(resp.body)}`);
            });

            it("returns success if results count < default limit", async () => {
                const resp = await testUtils.testAuthedCsvRequest(router, `/v2/reports/values`, "GET");
                chai.assert.equal(resp.statusCode, 200, `resp.body=${JSON.stringify(resp.body)}`);
                chai.assert.deepInclude(resp.headers as any, getValueReportHeadersForAssertions(), `resp.headers=${JSON.stringify(resp.headers)}`);
                chai.assert.equal(resp.body.length, valueCount, `resp.body=${JSON.stringify(resp.body)}`);
            });

            it("returns error if results count > default limit", async () => {
                sinonSandbox.stub(Reports, "getValuesForReport")
                    .onFirstCall().resolves({
                    results: (mockResults10000),
                    pagination: {limit: 10000, maxLimit: 10000, after: "", before: null}
                })
                    .onSecondCall().resolves({
                    results: (mockResults1),
                    pagination: {limit: 1, maxLimit: 1, after: "", before: null}
                });

                const resp = await testUtils.testAuthedRequest(router, `/v2/reports/values`, "GET");
                chai.assert.equal(resp.statusCode, 422, `resp.body=${JSON.stringify(resp.body)}`);
            });

            it("returns success if results count == default limit", async () => {
                sinonSandbox.stub(Reports, "getValuesForReport")
                    .onFirstCall().resolves({
                    results: (mockResults10000),
                    pagination: {limit: 10000, maxLimit: 10000, after: "", before: null}
                })
                    .onSecondCall().resolves({
                    results: (mockResults0),
                    pagination: {limit: 1, maxLimit: 1, after: null, before: null}
                });


                const resp = await testUtils.testAuthedCsvRequest(router, `/v2/reports/values`, "GET");
                chai.assert.equal(resp.statusCode, 200, `resp.body=${JSON.stringify(resp.body)}`);
                chai.assert.equal(resp.body.length, 10000, `Expected 10000 results and got ${resp.body.length}.`);
            });
        });

        describe("'suppressLimitError=true'", () => {
            it("returns success if results count > limit", async () => {
                const resp = await testUtils.testAuthedCsvRequest(router, `/v2/reports/values?limit=${valueCount - 1}&suppressLimitError=true`, "GET");
                chai.assert.equal(resp.statusCode, 200, `resp.body=${JSON.stringify(resp.body)}`);
                chai.assert.deepInclude(resp.headers as any, getValueReportHeadersForAssertions(valueCount - 1), `resp.headers=${JSON.stringify(resp.headers)}`);
                chai.assert.equal(resp.body.length, valueCount - 1, `resp.body=${JSON.stringify(resp.body)}`);
            });

            it("returns success if results count == default limit", async () => {
                sinonSandbox.stub(Reports, "getValuesForReport")
                    .resolves({
                        results: (mockResults10000),
                        pagination: {limit: 10000, maxLimit: 10000, after: "", before: null}
                    });

                const resp = await testUtils.testAuthedCsvRequest(router, `/v2/reports/values?suppressLimitError=true`, "GET");
                chai.assert.equal(resp.statusCode, 200, `resp.body=${JSON.stringify(resp.body)}`);
                chai.assert.deepInclude(resp.headers as any, getValueReportHeadersForAssertions(), `resp.headers=${JSON.stringify(resp.headers)}`);
                chai.assert.equal(resp.body.length, 10000, `resp.body.length=${resp.body.length}`);
            });
        });
    });

    it("can query by programId and createdDate", async () => {
        const queryReports = await testUtils.testAuthedCsvRequest(router, `/v2/reports/values?programId=program1&createdDate.gte=2007-04-05T14:30:00.000Z`, "GET");
        chai.assert.equal(queryReports.statusCode, 200);
        chai.assert.deepInclude(queryReports.headers as any, getValueReportHeadersForAssertions(), `resp.headers=${JSON.stringify(queryReports.headers)}`);
        chai.assert.include(JSON.stringify(queryReports.body), valueFromProgram1.id);
    });
});
