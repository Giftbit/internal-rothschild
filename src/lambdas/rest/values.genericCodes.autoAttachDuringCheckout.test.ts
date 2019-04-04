import * as cassava from "cassava";
import * as chai from "chai";
import * as testUtils from "../../utils/testUtils";
import {generateFullcode, generateId, setCodeCryptographySecrets} from "../../utils/testUtils";
import {formatCodeForLastFourDisplay, Value} from "../../model/Value";
import {installRestRoutes} from "./installRestRoutes";
import {createCurrency} from "./currencies";
import {Contact} from "../../model/Contact";
import {Transaction} from "../../model/Transaction";
import {CheckoutRequest} from "../../model/TransactionRequest";
import {GenericCodePerContact} from "./genericCodePerContact";
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
                    {rail: "lightrail", contactId: contact1Id},
                    // {rail: "lightrail", contactId: "sfgdfgdsfgsdfg"}, todo - try with an invalid contactId
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

    describe.only("auto attach simulate: false", () => {
        const contactId = generateId();

        before(async function () {
            const createContact = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", {id: contactId});
            chai.assert.equal(createContact.statusCode, 201);
        });

        const genericValue: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            isGenericCode: true,
            code: generateFullcode(),
            genericCodeProperties: {
                valuePropertiesPerContact: {
                    usesRemaining: 1,
                    balance: 500
                }
            },
            usesRemaining: null,
            balance: null,
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
                    {rail: "lightrail", contactId: contactId},
                    {rail: "lightrail", code: genericValue.code}
                ],
                lineItems: [
                    {unitPrice: 777}
                ],
                allowRemainder: true,
                simulate: false
            };
            const checkout = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
            console.log("checkout response\n" + JSON.stringify(checkout.body, null, 4));

            chai.assert.deepEqualExcluding(checkout.body, {
                    "id": checkoutRequest.id,
                    "transactionType": "checkout",
                    "currency": "USD",
                    "createdDate": null,
                    "tax": {
                        "roundingMode": "HALF_EVEN"
                    },
                    "totals": {
                        "subtotal": 777,
                        "tax": 0,
                        "discount": 0,
                        "payable": 777,
                        "remainder": 277,
                        "discountLightrail": 0,
                        "paidLightrail": 500,
                        "paidStripe": 0,
                        "paidInternal": 0
                    },
                    "lineItems": [
                        {
                            "unitPrice": 777,
                            "quantity": 1,
                            "lineTotal": {
                                "subtotal": 777,
                                "taxable": 777,
                                "tax": 0,
                                "discount": 0,
                                "remainder": 277,
                                "payable": 777
                            }
                        }
                    ],
                    "steps": [
                        {
                            "rail": "lightrail",
                            "valueId": genericValue.id,
                            "contactId": null,
                            "code": genericValue.code,
                            "balanceBefore": null,
                            "balanceChange": null,
                            "balanceAfter": null,
                            "usesRemainingBefore": null,
                            "usesRemainingChange": null,
                            "usesRemainingAfter": null
                        },
                        {
                            "rail": "lightrail",
                            "valueId": GenericCodePerContact.generateValueId(genericValue.id, contactId),
                            "contactId": contactId,
                            "code": null,
                            "balanceBefore": 0,
                            "balanceChange": 500,
                            "balanceAfter": 500,
                            "usesRemainingBefore": 0,
                            "usesRemainingChange": 1,
                            "usesRemainingAfter": 1
                        },
                        {
                            "rail": "lightrail",
                            "valueId": GenericCodePerContact.generateValueId(genericValue.id, contactId),
                            "contactId": contactId,
                            "code": null,
                            "balanceBefore": 500,
                            "balanceChange": -500,
                            "balanceAfter": 0,
                            "usesRemainingBefore": 1,
                            "usesRemainingChange": -1,
                            "usesRemainingAfter": 0
                        }
                    ],
                    "paymentSources": [
                        {
                            "rail": "lightrail",
                            "contactId": contactId
                        },
                        {
                            "rail": "lightrail",
                            "code": genericValue.code
                        }
                    ],
                    "pending": false,
                    "metadata": null,
                    "createdBy": "default-test-user-TEST"
                }, ["createdDate"]
            )
        }).timeout(5000);
    });

    describe.only("auto attach, generic code with balanceRule and usesRemaining", () => {
        const contactId = generateId();

        before(async function () {
            const createContact = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", {id: contactId});
            chai.assert.equal(createContact.statusCode, 201);
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
            usesRemaining: 5,
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
                    {rail: "lightrail", contactId: contactId},
                    {rail: "lightrail", code: genericValue.code}
                ],
                lineItems: [
                    {unitPrice: 777}
                ],
                allowRemainder: true,
                simulate: false
            };
            const checkout = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
            console.log("checkout response\n" + JSON.stringify(checkout.body, null, 4));

            chai.assert.deepEqualExcluding(checkout.body, {
                    "id": checkoutRequest.id,
                    "transactionType": "checkout",
                    "currency": "USD",
                    "createdDate": null,
                    "tax": {
                        "roundingMode": "HALF_EVEN"
                    },
                    "totals": {
                        "subtotal": 777,
                        "tax": 0,
                        "discount": 0,
                        "payable": 777,
                        "remainder": 277,
                        "discountLightrail": 0,
                        "paidLightrail": 500,
                        "paidStripe": 0,
                        "paidInternal": 0
                    },
                    "lineItems": [
                        {
                            "unitPrice": 777,
                            "quantity": 1,
                            "lineTotal": {
                                "subtotal": 777,
                                "taxable": 777,
                                "tax": 0,
                                "discount": 0,
                                "remainder": 277,
                                "payable": 777
                            }
                        }
                    ],
                    "steps": [
                        {
                            "rail": "lightrail",
                            "valueId": genericValue.id,
                            "contactId": null,
                            "code": genericValue.code,
                            "balanceBefore": null,
                            "balanceChange": null,
                            "balanceAfter": null,
                            "usesRemainingBefore": 5,
                            "usesRemainingChange": -1,
                            "usesRemainingAfter": 4
                        },
                        {
                            "rail": "lightrail",
                            "valueId": GenericCodePerContact.generateValueId(genericValue.id, contactId),
                            "contactId": contactId,
                            "code": null,
                            "balanceBefore": null,
                            "balanceChange": null,
                            "balanceAfter": null,
                            "usesRemainingBefore": 0,
                            "usesRemainingChange": 1,
                            "usesRemainingAfter": 1
                        },
                        {
                            "rail": "lightrail",
                            "valueId": GenericCodePerContact.generateValueId(genericValue.id, contactId),
                            "contactId": contactId,
                            "code": null,
                            "balanceBefore": null,
                            "balanceChange": -500,
                            "balanceAfter": null,
                            "usesRemainingBefore": 1,
                            "usesRemainingChange": -1,
                            "usesRemainingAfter": 0
                        }
                    ],
                    "paymentSources": [
                        {
                            "rail": "lightrail",
                            "contactId": contactId
                        },
                        {
                            "rail": "lightrail",
                            "code": genericValue.code
                        }
                    ],
                    "pending": false,
                    "metadata": null,
                    "createdBy": "default-test-user-TEST"
                }, ["createdDate"]
            )
        }).timeout(5000);
    });

    describe.only("doesn't auto attach if attached Value isn't used", () => {
        const contactId = generateId();
        const discountValueId = generateId();

        before(async function () {
            const createContact = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", {id: contactId});
            chai.assert.equal(createContact.statusCode, 201);

            const discount: Partial<Value> = {
                id: discountValueId,
                balance: 1000,
                discount: true,
                currency: "USD",
                contactId: contactId
            };
            const addDiscount = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", discount);
            chai.assert.equal(addDiscount.statusCode, 201);
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
            usesRemaining: 5,
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
                    {rail: "lightrail", contactId: contactId},
                    {rail: "lightrail", code: genericValue.code}
                ],
                lineItems: [
                    {unitPrice: 777}
                ],
                allowRemainder: true,
                simulate: false
            };
            const checkout = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
            console.log("checkout response\n" + JSON.stringify(checkout.body, null, 4));

            chai.assert.deepEqualExcluding(checkout.body, {
                    "id": checkoutRequest.id,
                    "transactionType": "checkout",
                    "currency": "USD",
                    "createdDate": null,
                    "tax": {
                        "roundingMode": "HALF_EVEN"
                    },
                    "totals": {
                        "subtotal": 777,
                        "tax": 0,
                        "discount": 777,
                        "payable": 0,
                        "remainder": 0,
                        "discountLightrail": 777,
                        "paidLightrail": 0,
                        "paidStripe": 0,
                        "paidInternal": 0
                    },
                    "lineItems": [
                        {
                            "unitPrice": 777,
                            "quantity": 1,
                            "lineTotal": {
                                "subtotal": 777,
                                "taxable": 777,
                                "tax": 0,
                                "discount": 777,
                                "remainder": 0,
                                "payable": 0
                            }
                        }
                    ],
                    "steps": [
                        // no attach steps
                        {
                            "rail": "lightrail",
                            "valueId": discountValueId,
                            "contactId": contactId,
                            "code": null,
                            "balanceBefore": 1000,
                            "balanceChange": -777,
                            "balanceAfter": 223,
                            "usesRemainingBefore": null,
                            "usesRemainingChange": null,
                            "usesRemainingAfter": null
                        }
                    ],
                    "paymentSources": [
                        {
                            "rail": "lightrail",
                            "contactId": contactId
                        },
                        {
                            "rail": "lightrail",
                            "code": formatCodeForLastFourDisplay(genericValue.code) // this is interesting. since the generic value isn't used in the steps, our logic to sanitize this doesn't realize it was a generic code
                        }
                    ],
                    "pending": false,
                    "metadata": null,
                    "createdBy": "default-test-user-TEST"
                }, ["createdDate"]
            )
        }).timeout(5000);
    });
});
