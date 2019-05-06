import * as cassava from "cassava";
import * as chai from "chai";
import * as testUtils from "../../../../utils/testUtils/index";
import {generateId, setCodeCryptographySecrets} from "../../../../utils/testUtils/index";
import {installRestRoutes} from "../../installRestRoutes";
import {createCurrency} from "../../currencies";
import {Value} from "../../../../model/Value";
import {Transaction} from "../../../../model/Transaction";
import {ReverseRequest} from "../../../../model/TransactionRequest";
import {Contact} from "../../../../model/Contact";
import chaiExclude = require("chai-exclude");

chai.use(chaiExclude);

describe("/v2/transactions/reverse - attach", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);

        await setCodeCryptographySecrets();

        const currency = await createCurrency(testUtils.defaultTestUser.auth, {
            code: "USD",
            name: "US Dollars",
            symbol: "$",
            decimalPlaces: 2
        });
        chai.assert.equal(currency.code, "USD");
    });

    it("can reverse attach on non generic value", async () => {
        // create value
        const value: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            balance: 100
        };
        const postValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
        chai.assert.equal(postValue.statusCode, 201);
        chai.assert.equal(postValue.body.balance, 100);

        // create contact
        const contact: Partial<Contact> = {
            id: generateId(),
            email: "kevin.bacon@example.com"
        };
        const postContact = await testUtils.testAuthedRequest<Contact>(router, `/v2/contacts`, "POST", contact);
        chai.assert.equal(postContact.statusCode, 201);

        // create attach
        const postAttach = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {valueId: value.id});
        chai.assert.equal(postAttach.statusCode, 200, `body=${JSON.stringify(postAttach.body)}`);
        chai.assert.equal(postAttach.body.contactId, contact.id);
        chai.assert.equal(postAttach.body.balance, 100);

        // create reverse
        const reverse: Partial<ReverseRequest> = {
            id: generateId()
        };
        const simulate = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${postAttach.body.id}/reverse`, "POST", {
            ...reverse,
            simulate: true
        });
        const postReverse = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${postAttach.body.id}/reverse`, "POST", reverse);
        chai.assert.equal(postReverse.statusCode, 201, `body=${JSON.stringify(postAttach.body)}`);
        chai.assert.deepEqualExcluding(postReverse.body, {
                "id": reverse.id,
                "transactionType": "reverse",
                "currency": "USD",
                "createdDate": null,
                "totals": null,
                "lineItems": null,
                "tax": null,
                "steps": [
                    {
                        "rail": "lightrail",
                        "valueId": value.id,
                        "contactId": contact.id,
                        "code": null,
                        "balanceBefore": 100,
                        "balanceAfter": 0,
                        "balanceChange": -100,
                        "usesRemainingBefore": null,
                        "usesRemainingAfter": null,
                        "usesRemainingChange": null
                    }
                ],
                "paymentSources": null,
                "pending": false,
                "metadata": null,
                "createdBy": "default-test-user-TEST"
            } as Transaction, ["createdDate"]
        );
        chai.assert.deepEqualExcluding(simulate.body, postReverse.body, "simulated", "createdDate");
        chai.assert.isTrue(simulate.body.simulated);

        // check value is same as before
        const getValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
        chai.assert.deepEqualExcluding(getValue.body, {
            ...postValue.body,
            contactId: contact.id,
            balance: 0
        }, ["updatedDate", "updatedContactIdDate"]);
    });

    it("can reverse attach on generic value", async () => {
        // create value
        const genericValue: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            balanceRule: {
                rule: "100",
                explanation: "$1"
            },
            usesRemaining: 4,
            discount: true,
            isGenericCode: true
        };
        const postValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", genericValue);
        chai.assert.equal(postValue.statusCode, 201);

        // create contact
        const contact: Partial<Contact> = {
            id: generateId(),
            email: "kevin.bacon@example.com"
        };
        const postContact = await testUtils.testAuthedRequest<Contact>(router, `/v2/contacts`, "POST", contact);
        chai.assert.equal(postContact.statusCode, 201);

        // create attach
        const postAttach = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {
            valueId: genericValue.id,
            attachGenericAsNewValue: true
        });
        chai.assert.equal(postAttach.statusCode, 200, `body=${JSON.stringify(postAttach.body)}`);
        chai.assert.equal(postAttach.body.contactId, contact.id);
        chai.assert.equal(postAttach.body.usesRemaining, 1);

        // create reverse
        const lookupAttachTransaction = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?valueId=${encodeURIComponent(postAttach.body.id)}`, "GET"); // attach on generic uses a hash so can have special characters
        const reverse: Partial<ReverseRequest> = {
            id: generateId()
        };
        const postReverse = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${encodeURIComponent(lookupAttachTransaction.body[0].id)}/reverse`, "POST", reverse); // attach on generic uses a hash so can have special characters
        chai.assert.equal(postReverse.statusCode, 201, `body=${JSON.stringify(postReverse.body)}`);
        chai.assert.deepEqualExcluding(postReverse.body, {
                "id": reverse.id,
                "transactionType": "reverse",
                "currency": "USD",
                "createdDate": null,
                "totals": null,
                "lineItems": null,
                "tax": null,
                "steps": [
                    {
                        "rail": "lightrail",
                        "valueId": genericValue.id,
                        "contactId": null,
                        "code": null,
                        "balanceBefore": null,
                        "balanceAfter": null,
                        "balanceChange": 0,
                        "usesRemainingBefore": 3,
                        "usesRemainingAfter": 4,
                        "usesRemainingChange": 1
                    },
                    {
                        "rail": "lightrail",
                        "valueId": postAttach.body.id,
                        "contactId": contact.id,
                        "code": null,
                        "balanceBefore": null,
                        "balanceAfter": null,
                        "balanceChange": 0,
                        "usesRemainingBefore": 1,
                        "usesRemainingAfter": 0,
                        "usesRemainingChange": -1
                    }
                ],
                "paymentSources": null,
                "pending": false,
                "metadata": null,
                "createdBy": "default-test-user-TEST"
            } as Transaction, ["createdDate"]
        );

        // check value is same as before
        const getValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${genericValue.id}`, "GET");
        chai.assert.deepEqualExcluding(getValue.body, postValue.body, ["updatedDate", "updatedContactIdDate"]);
    });
});
