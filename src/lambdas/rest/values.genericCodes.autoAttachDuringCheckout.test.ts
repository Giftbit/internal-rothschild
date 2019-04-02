import * as cassava from "cassava";
import * as chai from "chai";
import * as testUtils from "../../utils/testUtils";
import {generateFullcode, generateId, setCodeCryptographySecrets} from "../../utils/testUtils";
import {Value} from "../../model/Value";
import {installRestRoutes} from "./installRestRoutes";
import {createCurrency} from "./currencies";
import {Contact} from "../../model/Contact";
import {Transaction} from "../../model/Transaction";
import {CheckoutRequest} from "../../model/TransactionRequest";
import chaiExclude = require("chai-exclude");

chai.use(chaiExclude);

describe("/v2/values - generic code with per contact properties", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);
        await setCodeCryptographySecrets();
        await createCurrency(testUtils.defaultTestUser.auth, {
            code: "USD",
            name: "US Dollars",
            symbol: "$",
            decimalPlaces: 2
        });
    });

    describe("auto attach simulate: true", () => {
        const contact1Id = generateId();

        before(async function () {
            const createContact1 = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", {id: contact1Id});
            chai.assert.equal(createContact1.statusCode, 201);
        });

        const genericValue: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            isGenericCode: true,
            code: generateFullcode(),
            genericCodeProperties: {
                valuePropertiesPerContact: {
                    usesRemaining: 1,
                    balance: null
                }
            },
            usesRemaining: null,
            balance: null,
            balanceRule: {
                rule: "500 + value.balanceChange",
                explanation: "$5 off purchase"
            }
        };

        it("can create generic value", async () => {
            const create = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", genericValue);
            chai.assert.equal(create.statusCode, 201);
            chai.assert.deepNestedInclude(create.body, genericValue);
        });

        it("can checkout against contact1", async () => {
            const checkoutRequest: CheckoutRequest = {
                id: generateId(),
                currency: "USD",
                sources: [
                    // {rail: "lightrail", contactId: contact1Id},
                    {rail: "lightrail", contactId: "sfgdfgdsfgsdfg"},
                    {rail: "lightrail", code: genericValue.code}
                ],
                lineItems: [
                    {unitPrice: 777}
                ],
                allowRemainder: true,
                simulate: true
            };
            const checkout = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
            console.log(JSON.stringify(checkout.body, null, 4));

        });
    });

    describe("auto attach simulate: false", () => {
        const contact1Id = generateId();

        before(async function () {
            const createContact1 = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", {id: contact1Id});
            chai.assert.equal(createContact1.statusCode, 201);
        });

        const genericValue: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            isGenericCode: true,
            code: generateFullcode(),
            genericCodeProperties: {
                valuePropertiesPerContact: {
                    usesRemaining: 1,
                    balance: null
                }
            },
            usesRemaining: null,
            balance: null,
            balanceRule: {
                rule: "500 + value.balanceChange",
                explanation: "$5 off purchase"
            }
        };

        it("can create generic value", async () => {
            const create = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", genericValue);
            chai.assert.equal(create.statusCode, 201);
            chai.assert.deepNestedInclude(create.body, genericValue);
        });

        it("can checkout against contact1", async () => {
            const checkoutRequest: CheckoutRequest = {
                id: generateId(),
                currency: "USD",
                sources: [
                    {rail: "lightrail", contactId: contact1Id},
                    {rail: "lightrail", code: genericValue.code}
                ],
                lineItems: [
                    {unitPrice: 777}
                ],
                allowRemainder: true,
                simulate: false
            };
            console.log("calling checkout in test.");
            const checkout = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
            console.log(JSON.stringify(checkout.body, null, 4));

            const txs = await testUtils.testAuthedRequest(router, "/v2/transactions", "GET")
            console.log(JSON.stringify(txs, null, 4));
        }).timeout(5000);
    });
});
