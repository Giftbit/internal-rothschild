import * as cassava from "cassava";
import * as chai from "chai";
import * as testUtils from "../../utils/testUtils";
import {generateId, setCodeCryptographySecrets} from "../../utils/testUtils";
import {Value} from "../../model/Value";
import {installRestRoutes} from "./installRestRoutes";
import {createCurrency} from "./currencies";
import {Contact} from "../../model/Contact";
import {Transaction} from "../../model/Transaction";
import {CheckoutRequest} from "../../model/TransactionRequest";
import chaiExclude = require("chai-exclude");

chai.use(chaiExclude);

describe.only("/v2/values/", () => {

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

    describe("set of test to create a generic value, attach, view in context of contact, view in context of generic code, and checkout", () => {
        const genericValue: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            isGenericCode: true,
            code: "SIGNUP2019",
            genericCodeProperties: { // todo - genericCodeLimits? the nested property could be perContactLimits?
                valuePropertiesPerContact: { // todo - consider name? "perContact" makes sense. ValueProperties might not make sense since we are not creating another Value. limitsPerContact?
                    balance: 500,
                    usesRemaining: null
                }
            },
            balance: 5000 // todo - don't care if these numbers are in sync.
        };
        it("can create generic value", async () => {
            const create = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", genericValue);
            chai.assert.equal(create.statusCode, 201);
            chai.assert.deepNestedInclude(create.body, genericValue);

            const get = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${genericValue.id}`, "GET");
            chai.assert.equal(get.statusCode, 200);
            chai.assert.deepEqual(create.body, get.body);
        });

        const contactId = generateId();
        it.skip("can attach generic value", async () => {
            const contact: Partial<Contact> = {
                id: contactId
            };

            const createContact = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", contact);
            chai.assert.equal(createContact.statusCode, 201);

            const attach = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contactId}/values/attach`, "POST", {code: genericValue.code});
            chai.assert.equal(attach.statusCode, 200);
            chai.assert.deepEqualExcluding(attach.body,
                {
                    id: genericValue.id,
                    currency: "USD",
                    balance: 5000, // todo - slight bug
                    usesRemaining: 10, //
                    programId: null,
                    issuanceId: null,
                    contactId: null,
                    code: "SIGNUP2019",
                    isGenericCode: true,
                    genericCodeProperties: { // todo - doesn't seem like there's a strong reason to exclude. Any of these generic code properties means it can't be used in checkout.
                        valuePropertiesPerContact: {
                            balance: 500,
                            usesRemaining: 2
                        },
                        // attachesRemaining: 10
                    },
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
                    metadata: {},
                    createdDate: null,
                    updatedDate: null,
                    updatedContactIdDate: null,
                    createdBy: "default-test-user-TEST"
                }, ["createdDate", "updatedDate"]);


            const getTx = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/values/${attach.body.id}/transactions?transactionType=attach`, "GET");
            chai.assert.equal(getTx.statusCode, 200);
            chai.assert.deepEqualExcluding(getTx.body[0],
                {
                    id: null, // it's a hash.
                    transactionType: "attach",
                    currency: "USD",
                    totals: null,
                    lineItems: null,
                    paymentSources: null,
                    steps: [ // todo - all attaches should have a transaction, even if it doesn't have generic code limit. The step should still be included because it contains contact info.
                        { // TODO - Review this step with JG. Balance etc.
                            rail: "lightrail",
                            valueId: genericValue.id,
                            contactId: contactId,
                            code: null,
                            balanceBefore: 5000,
                            balanceAfter: 4500,
                            balanceChange: -500,
                            usesRemainingBefore: 10,
                            usesRemainingAfter: 8,
                            usesRemainingChange: -2
                        }
                    ],
                    metadata: null,
                    tax: null,
                    pending: false,
                    createdDate: null,
                    createdBy: "default-test-user-TEST"
                }, ["id", "createdDate"]);

            const listContactValues = await testUtils.testAuthedRequest<Value[]>(router, `/v2/contacts/${contactId}/values`, "GET");
            chai.assert.equal(listContactValues.statusCode, 200);
            chai.assert.equal(listContactValues.body.length, 1);
            chai.assert.deepEqualExcluding(listContactValues.body[0], {
                id: genericValue.id,
                currency: "USD",
                balance: 500,
                usesRemaining: null,
                programId: null,
                issuanceId: null,
                contactId: contactId,
                code: "SIGNUP2019",
                isGenericCode: true,
                genericCodeProperties: {
                    valuePropertiesPerContact: {
                        balance: 500,
                        usesRemaining: null
                    },
                    attachesRemaining: 9
                },
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
                metadata: {},
                createdDate: null,
                updatedDate: null,
                updatedContactIdDate: null,
                createdBy: "default-test-user-TEST"
            }, ["createdDate", "updatedDate"]);

            console.log(JSON.stringify(listContactValues.body, null, 4));
        });

        it.skip("can checkout against generic code using contactId", async () => {
            const checkoutRequest: CheckoutRequest = {
                id: generateId(),
                currency: "USD",
                sources: [
                    {rail: "lightrail", contactId: contactId}
                ],
                lineItems: [
                    {unitPrice: 777}
                ],
                allowRemainder: true
            };
            const checkout = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
            chai.assert.equal(checkout.statusCode, 201);
            chai.assert.deepEqualExcluding(checkout.body, {
                id: checkoutRequest.id,
                transactionType: "checkout",
                currency: "USD",
                createdDate: null,
                tax: {
                    roundingMode: "HALF_EVEN"
                },
                totals: {
                    subtotal: 777,
                    tax: 0,
                    discount: 0,
                    payable: 777,
                    remainder: 277,
                    discountLightrail: 0,
                    paidLightrail: 500,
                    paidStripe: 0,
                    paidInternal: 0
                },
                lineItems: [
                    {
                        unitPrice: 777,
                        quantity: 1,
                        lineTotal: {
                            subtotal: 777,
                            taxable: 777,
                            tax: 0,
                            discount: 0,
                            remainder: 277,
                            payable: 777
                        }
                    }
                ],
                steps: [
                    {
                        rail: "lightrail",
                        valueId: genericValue.id,
                        contactId: contactId,
                        code: "SIGNUP2019",
                        balanceBefore: 500,
                        balanceAfter: 0,
                        balanceChange: -500,
                        usesRemainingBefore: null,
                        usesRemainingAfter: null,
                        usesRemainingChange: null
                    }
                ],
                paymentSources: [
                    {
                        rail: "lightrail",
                        contactId: contactId
                    }
                ],
                pending: false,
                metadata: null,
                createdBy: "default-test-user-TEST"
            }, ["createdDate"]);
        });
    });
});
