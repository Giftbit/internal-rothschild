import * as cassava from "cassava";
import * as chai from "chai";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as transactions from "./transactions";
import * as valueStores from "../valueStores";
import * as testUtils from "../../../testUtils";
import {ValueStore} from "../../../model/ValueStore";
import {Transaction} from "../../../model/Transaction";

describe("/v2/transactions/debit", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(Promise.resolve({secretkey: "secret"})));
        transactions.installTransactionsRest(router);
        valueStores.installValueStoresRest(router);
    });

    const valueStore1: Partial<ValueStore> = {
        valueStoreId: "vs-debit-1",
        valueStoreType: "GIFTCARD",
        currency: "CAD",
        value: 1000
    };

    it("can create a basic order", async () => {
        const postValueStoreResp = await testUtils.testAuthedRequest<ValueStore>(router, "/v2/valueStores", "POST", valueStore1);
        chai.assert.equal(postValueStoreResp.statusCode, 201, `body=${JSON.stringify(postValueStoreResp.body)}`);

        const postOrderResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/order", "POST", {
            transactionId: "order-1",
            sources: [
                {
                    rail: "lightrail",
                    valueStoreId: valueStore1.valueStoreId
                }
            ],
            lineItems: [
                {
                    type: "product",
                    productId: "xyz-123",
                    unitPrice: 50
                }
            ],
            currency: "CAD"
        });
        chai.assert.equal(postOrderResp.statusCode, 201, `body=${JSON.stringify(postOrderResp.body)}`);
        chai.assert.deepEqualExcluding(postOrderResp.body, {
            transactionId: "debit-1",
            transactionType: "debit",
            remainder: 0,
            steps: [
                {
                    rail: "lightrail",
                    valueStoreId: valueStore1.valueStoreId,
                    valueStoreType: valueStore1.valueStoreType,
                    currency: valueStore1.currency,
                    codeLastFour: null,
                    customerId: null,
                    valueBefore: 1000,
                    valueAfter: 401,
                    valueChange: -599
                }
            ]
        }, ["createdDate"]);

        const getValueStoreResp = await testUtils.testAuthedRequest<ValueStore>(router, `/v2/valueStores/${valueStore1.valueStoreId}`, "GET");
        chai.assert.equal(getValueStoreResp.statusCode, 200, `body=${JSON.stringify(getValueStoreResp.body)}`);
        chai.assert.equal(getValueStoreResp.body.value, 401);
    });
});
