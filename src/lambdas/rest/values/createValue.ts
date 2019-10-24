import * as giftbitRoutes from "giftbit-cassava-routes";
import {GiftbitRestError} from "giftbit-cassava-routes";
import * as Knex from "knex";
import {
    formatDiscountSellerLiabilityAsRule,
    formatDiscountSellerLiabilityRuleAsNumber,
    Value
} from "../../../model/Value";
import {dateInDbPrecision, nowInDbPrecision} from "../../../utils/dbUtils/index";
import * as cassava from "cassava";
import {MetricsLogger, ValueAttachmentTypes} from "../../../utils/metricsLogger";
import {Program} from "../../../model/Program";
import {GenerateCodeParameters} from "../../../model/GenerateCodeParameters";
import {pickOrDefault} from "../../../utils/pick";
import {CreateValueParameters} from "./values";
import {checkRulesSyntax} from "../transactions/rules/RuleContext";
import {LightrailInsertTransactionPlanStep, TransactionPlan} from "../transactions/TransactionPlan";
import {executeTransactionPlan} from "../transactions/executeTransactionPlans";
import log = require("loglevel");

export async function createValue(auth: giftbitRoutes.jwtauth.AuthorizationBadge, params: CreateValueParameters, trx: Knex.Transaction): Promise<Value> {
    auth.requireIds("userId", "teamMemberId");
    let value: Value = initializeValue(auth, params.partialValue, params.program, params.generateCodeParameters);
    log.info(`Create Value requested for user: ${auth.userId}. Value`, Value.toStringSanitized(value));

    value.startDate = value.startDate ? dateInDbPrecision(new Date(value.startDate)) : null;
    value.endDate = value.endDate ? dateInDbPrecision(new Date(value.endDate)) : null;

    const step: LightrailInsertTransactionPlanStep = {
        rail: "lightrail",
        value: value,
        action: "insert",
        generateCodeParameters: params.generateCodeParameters
    };
    const plan: TransactionPlan = {
        id: value.id,
        transactionType: "initialBalance",
        currency: value.currency,
        totals: null,
        lineItems: null,
        paymentSources: null,
        steps: [step],
        tax: null,
        pendingVoidDate: null,
        createdDate: value.createdDate,
        metadata: null,
    };

    try {
        await executeTransactionPlan(auth, trx, plan, {simulate: false, allowRemainder: false});
    } catch (err) {
        if ((err as GiftbitRestError).statusCode === 409 && err.additionalParams.messageCode === "TransactionExists") {
            throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `A Value with id '${value.id}' already exists.`, "ValueIdExists");
        }
        throw err;
    }

    if (value.contactId) {
        MetricsLogger.valueAttachment(ValueAttachmentTypes.OnCreate, auth);
    }
    return value;
}

export function initializeValue(auth: giftbitRoutes.jwtauth.AuthorizationBadge, partialValue: Partial<Value>, program: Program = null, generateCodeParameters: GenerateCodeParameters = null): Value {
    const now = nowInDbPrecision();

    let value: Value = pickOrDefault(partialValue, {
        id: null,
        currency: program ? program.currency : null,
        balance: partialValue.balanceRule || (program && program.balanceRule) || (Value.isGenericCodeWithPropertiesPerContact(partialValue)) ? null : 0,
        usesRemaining: null,
        programId: program ? program.id : null,
        issuanceId: null,
        code: null,
        isGenericCode: false,
        genericCodeOptions: partialValue.genericCodeOptions ? partialValue.genericCodeOptions : partialValue.isGenericCode ? null : undefined,
        attachedFromValueId: undefined,
        contactId: null,
        pretax: program ? program.pretax : false,
        active: program ? program.active : true,
        canceled: false,
        frozen: false,
        discount: program ? program.discount : false,
        discountSellerLiability: program ? program.discountSellerLiability : null,
        discountSellerLiabilityRule: program ? program.discountSellerLiabilityRule : null,
        redemptionRule: program ? program.redemptionRule : null,
        balanceRule: program ? program.balanceRule : null,
        startDate: program ? program.startDate : null,
        endDate: program ? program.endDate : null,
        metadata: {},
        createdDate: now,
        updatedDate: now,
        updatedContactIdDate: partialValue.contactId ? now : null,
        createdBy: auth.teamMemberId ? auth.teamMemberId : auth.userId,
    });

    value.metadata = {...(program && program.metadata ? program.metadata : {}), ...value.metadata};

    if (value.discountSellerLiability != null) {
        value.discountSellerLiabilityRule = formatDiscountSellerLiabilityAsRule(value);
    } else if (value.discountSellerLiabilityRule != null) {
        value.discountSellerLiability = formatDiscountSellerLiabilityRuleAsNumber(value.discountSellerLiabilityRule);
    }

    // code generation is done when the Value is inserted into the database.
    checkCodeParameters(generateCodeParameters, value.code);

    checkValueProperties(value, program);
    return value;
}

export function checkValueProperties(value: Value, program: Program = null): void {
    if (program) {
        checkProgramConstraints(value, program);
    }

    if (value.balance != null && value.balanceRule) {
        throw new cassava.RestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Value can't have both a balance and balanceRule.`);
    }
    if (value.discountSellerLiability !== null && !value.discount) {
        throw new cassava.RestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Value can't have discountSellerLiability if it is not a discount.`);
    }
    if (value.discountSellerLiabilityRule !== null && !value.discount) {
        throw new cassava.RestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Value can't have a discountSellerLiabilityRule if it is not a discount.`);
    }
    if (value.contactId && value.isGenericCode) {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, "A Value with isGenericCode=true cannot have contactId set.");
    }
    if (value.endDate && value.startDate > value.endDate) {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, "Property startDate cannot exceed endDate.");
    }
    if (!value.currency) {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, "Property currency cannot be null. Please provide a currency or a programId.");
    }

    // generic value checks
    if (value.genericCodeOptions && !value.isGenericCode) {
        throw new cassava.RestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Value must have \`isGenericCode:true\` if setting genericCodeOptions.`);
    }
    if (value.genericCodeOptions && value.genericCodeOptions.perContact.balance != null && value.balanceRule) {
        throw new cassava.RestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Value can't have both a genericCodeOptions.perContact.balance and balanceRule.`);
    }
    if (Value.isGenericCodeWithPropertiesPerContact(value) && (value.genericCodeOptions.perContact.balance == null && value.balanceRule == null)) {
        throw new cassava.RestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `If using a generic code with genericCodeOption.perContact properties either genericCodeOptions.perContact.balance or balanceRule must be set.`);
    }

    checkRulesSyntax(value, "Value");
}


function checkProgramConstraints(value: Value, program: Program): void {
    let balance = value.balance;
    let usesRemaining = value.usesRemaining;

    if (Value.isGenericCodeWithPropertiesPerContact(value)) {
        balance = value.genericCodeOptions.perContact.balance;
        usesRemaining = value.genericCodeOptions.perContact.usesRemaining;
    }

    if (program.fixedInitialBalances && (program.fixedInitialBalances.indexOf(balance) === -1 || balance === null)) {
        throw new cassava.RestError(cassava.httpStatusCode.clientError.CONFLICT, `Value's balance ${balance} is outside fixedInitialBalances defined by Program ${program.fixedInitialBalances}.`);
    }
    if (program.minInitialBalance !== null && (balance < program.minInitialBalance || balance === null)) {
        throw new cassava.RestError(cassava.httpStatusCode.clientError.CONFLICT, `Value's balance ${balance} is less than minInitialBalance ${program.minInitialBalance}.`);
    }
    if (program.maxInitialBalance !== null && (balance > program.maxInitialBalance || balance === null)) {
        throw new cassava.RestError(cassava.httpStatusCode.clientError.CONFLICT, `Value's balance ${balance} is greater than maxInitialBalance ${program.maxInitialBalance}.`);
    }

    if (program.fixedInitialUsesRemaining && (program.fixedInitialUsesRemaining.indexOf(usesRemaining) === -1 || !usesRemaining)) {
        throw new cassava.RestError(cassava.httpStatusCode.clientError.CONFLICT, `Value's usesRemaining ${usesRemaining} outside fixedInitialUsesRemaining defined by Program ${program.fixedInitialUsesRemaining}.`);
    }

    if (program.currency !== value.currency) {
        throw new cassava.RestError(cassava.httpStatusCode.clientError.CONFLICT, `Value's currency ${value.currency} cannot differ from currency of Program ${program.currency}.`);
    }
}

export function checkCodeParameters(generateCode: GenerateCodeParameters, code: string): void {
    if (generateCode && code) {
        throw new cassava.RestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Parameter generateCode is not allowed with parameters code or isGenericCode:true.`);
    }
}
