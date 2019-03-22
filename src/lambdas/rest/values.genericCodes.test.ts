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

describe("/v2/values/", () => {

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
            genericCodeProperties: {
                valuePropertiesPerContact: {
                    balance: 500,
                    usesRemaining: 2
                }
            },
            balance: 5000,
            usesRemaining: 10
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
        let attachedValueId: string;
        it("can attach generic value", async () => {
            const contact: Partial<Contact> = {
                id: contactId
            };

            const createContact = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", contact);
            chai.assert.equal(createContact.statusCode, 201);

            const attach = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contactId}/values/attach`, "POST", {code: genericValue.code});
            chai.assert.equal(attach.statusCode, 200);
            chai.assert.deepEqualExcluding(attach.body,
                {
                    "id": null, // it's hashed
                    "currency": "USD",
                    "balance": 500,
                    "usesRemaining": 2,
                    "programId": null,
                    "issuanceId": null,
                    "contactId": contact.id,
                    "code": null,
                    "attachedFromGenericValueId": genericValue.id,
                    "isGenericCode": false,
                    "genericCodeProperties": null,
                    "pretax": false,
                    "active": true,
                    "canceled": false,
                    "frozen": false,
                    "discount": false,
                    "discountSellerLiability": null,
                    "redemptionRule": null,
                    "balanceRule": null,
                    "startDate": null,
                    "endDate": null,
                    "metadata": {
                        attachedFromGenericValue: {
                            code: "SIGNUP2019"
                        }
                    },
                    "createdDate": null,
                    "updatedDate": null,
                    "updatedContactIdDate": null,
                    "createdBy": "default-test-user-TEST"
                }, ["id", "createdDate", "updatedDate", "updatedContactIdDate"]);
            attachedValueId = attach.body.id;


            const getTx = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/values/${attach.body.id}/transactions?transactionType=attach`, "GET");
            chai.assert.equal(getTx.statusCode, 200);
            chai.assert.deepEqualExcluding(getTx.body[0],
                {
                    "id": attach.body.id, // the transaction.id is the same as the new attached value.id.
                    "transactionType": "attach",
                    "currency": "USD",
                    "totals": null,
                    "lineItems": null,
                    "paymentSources": null,
                    "steps": [
                        {
                            "rail": "lightrail",
                            "valueId": genericValue.id,
                            "contactId": null,
                            "code": "SIGNUP2019",
                            "balanceBefore": 5000,
                            "balanceAfter": 4500,
                            "balanceChange": -500,
                            "usesRemainingBefore": 10,
                            "usesRemainingAfter": 8,
                            "usesRemainingChange": -2
                        },
                        {
                            "rail": "lightrail",
                            "valueId": attach.body.id,
                            "contactId": contactId,
                            "code": null,
                            "balanceBefore": 0,
                            "balanceAfter": 500,
                            "balanceChange": 500,
                            "usesRemainingBefore": 0,
                            "usesRemainingAfter": 2,
                            "usesRemainingChange": 2
                        }
                    ],
                    "metadata": null,
                    "tax": null,
                    "pending": false,
                    "createdDate": null,
                    "createdBy": "default-test-user-TEST"
                }, ["createdDate"]);

            const listContactValues = await testUtils.testAuthedRequest<Value[]>(router, `/v2/contacts/${contactId}/values`, "GET");
            chai.assert.equal(listContactValues.statusCode, 200);
            chai.assert.equal(listContactValues.body.length, 1);
            chai.assert.deepEqualExcluding(listContactValues.body[0], {
                "id": attach.body.id,
                "currency": "USD",
                "balance": 500,
                "usesRemaining": 2,
                "programId": null,
                "issuanceId": null,
                "contactId": contact.id,
                "code": null,
                "attachedFromGenericValueId": genericValue.id,
                "isGenericCode": false,
                "genericCodeProperties": null,
                "pretax": false,
                "active": true,
                "canceled": false,
                "frozen": false,
                "discount": false,
                "discountSellerLiability": null,
                "redemptionRule": null,
                "balanceRule": null,
                "startDate": null,
                "endDate": null,
                "metadata": {
                    attachedFromGenericValue: {
                        code: "SIGNUP2019"
                    }
                },
                "createdDate": null,
                "updatedDate": null,
                "updatedContactIdDate": null,
                "createdBy": "default-test-user-TEST"
            }, ["createdDate", "updatedDate", "updatedContactIdDate"]);
        });

        it("can checkout against generic code using contactId", async () => {
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
                        valueId: attachedValueId,
                        contactId: contactId,
                        code: null,
                        balanceBefore: 500,
                        balanceAfter: 0,
                        balanceChange: -500,
                        usesRemainingBefore: 2,
                        usesRemainingAfter: 1,
                        usesRemainingChange: -1
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

    it.only("can't create a generic value with balance == null, balanceRule == null and valuePropertiesPerContact.balance == null", async () => {
        const genericValue: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            isGenericCode: true,
            code: "SUMMERTIME2020",
            genericCodeProperties: {
                valuePropertiesPerContact: {
                    balance: null,
                    usesRemaining: 2
                }
            }
        };

        const create = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", genericValue);
        chai.assert.equal(create.statusCode, 422);
        chai.assert.deepNestedInclude(create.body, genericValue);
    });
});
