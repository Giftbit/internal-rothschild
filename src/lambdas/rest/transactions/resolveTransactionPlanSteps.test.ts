import * as cassava from "cassava";
import * as chai from "chai";
import {Currency} from "../../../model/Currency";
import * as testUtils from "../../../utils/testUtils";
import {defaultTestUser, setCodeCryptographySecrets} from "../../../utils/testUtils";
import {installRestRoutes} from "../installRestRoutes";
import {createCurrency} from "../currencies";
import {createContact} from "../contacts";
import {Contact} from "../../../model/Contact";
import {ResolveTransactionPartiesOptions, resolveTransactionPlanSteps} from "./resolveTransactionPlanSteps";
import {LightrailTransactionPlanStep} from "./TransactionPlan";
import {AttachedContactValueScenario, setupAttachedContactValueScenario} from "../contactValues.test";

describe("resolveTransactionPlanSteps", () => {

    const router = new cassava.Router();

    const currency: Currency = {
        code: "AUD",
        decimalPlaces: 2,
        symbol: "$",
        name: "Dollarydoo"
    };

    const contact: Contact = {
        id: "c-1",
        firstName: null,
        lastName: null,
        email: null,
        metadata: null,
        createdDate: new Date(),
        updatedDate: new Date(),
        createdBy: defaultTestUser.auth.teamMemberId
    };

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);
        await setCodeCryptographySecrets();
        await createCurrency(testUtils.defaultTestUser.auth, currency);
        await createContact(testUtils.defaultTestUser.auth, contact);
    });

    describe("can resolve transaction parties for contacts with attached Values", () => {
        let data: AttachedContactValueScenario;
        before(async () => {
            data = await setupAttachedContactValueScenario(router, currency);
        });

        const txPartiesTemplate: ResolveTransactionPartiesOptions = {
            parties: [],
            currency: currency.code,
            transactionId: "1",
            nonTransactableHandling: "include",
            includeZeroUsesRemaining: true,
            includeZeroBalance: true
        };

        it("can get lightrail transaction plan steps associated with contactA", async () => {
            const contactAsTransactionSource: ResolveTransactionPartiesOptions = {
                ...txPartiesTemplate,
                parties: [
                    {
                        rail: "lightrail",
                        contactId: data.contactA.id
                    }
                ],
                currency: currency.code,
                transactionId: "1",
                nonTransactableHandling: "include",
                includeZeroUsesRemaining: true,
                includeZeroBalance: true
            };
            const contactLightrailValues = await resolveTransactionPlanSteps(testUtils.defaultTestUser.auth, contactAsTransactionSource);
            chai.assert.sameMembers(contactLightrailValues.transactionSteps.map(v => (v as LightrailTransactionPlanStep).value.id), data.valuesAttachedToContactA.map(v => v.id));
        });

        it("can get lightrail transaction plan steps associated with contactB", async () => {
            const contactAsTransactionSource: ResolveTransactionPartiesOptions = {
                ...txPartiesTemplate,
                parties: [
                    {
                        rail: "lightrail",
                        contactId: data.contactB.id
                    }
                ],
                currency: currency.code,
                transactionId: "1",
                nonTransactableHandling: "include",
                includeZeroUsesRemaining: true,
                includeZeroBalance: true
            };
            const contactLightrailValues = await resolveTransactionPlanSteps(testUtils.defaultTestUser.auth, contactAsTransactionSource);
            chai.assert.sameMembers(contactLightrailValues.transactionSteps.map(v => (v as LightrailTransactionPlanStep).value.id), data.valuesAttachedToContactB.map(v => v.id));
        });

        it("can get lightrail transaction plan steps associated with contactA and contactB. Doesnt duplicate shared generic Values.", async () => {
            const contactAsTransactionSource: ResolveTransactionPartiesOptions = {
                ...txPartiesTemplate,
                parties: [
                    {
                        rail: "lightrail",
                        contactId: data.contactA.id
                    },
                    {
                        rail: "lightrail",
                        contactId: data.contactB.id
                    }
                ],
                currency: currency.code,
                transactionId: "1",
                nonTransactableHandling: "include",
                includeZeroUsesRemaining: true,
                includeZeroBalance: true
            };
            const contactLightrailValues = await resolveTransactionPlanSteps(testUtils.defaultTestUser.auth, contactAsTransactionSource);

            const distinctValues = [...data.valuesAttachedToContactA, ...data.valuesAttachedToContactB.filter(v => v.id !== data.genVal2.id)];
            chai.assert.sameMembers(contactLightrailValues.transactionSteps.map(v => (v as LightrailTransactionPlanStep).value.id), distinctValues.map(v => v.id));
        });
    });
});
